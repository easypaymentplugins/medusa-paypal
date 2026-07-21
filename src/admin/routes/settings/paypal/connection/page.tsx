import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import PayPalTabs from "../_components/Tabs"

export const config = defineRouteConfig({
  label: "PayPal Connection",
})

// Let partner.js own the entire onboarding flow: it opens PayPal's mini-browser
// itself (synchronously inside the click, so no new tab / no popup block), it
// receives PayPal's completion postMessage, and it invokes the callback named in
// `data-paypal-onboard-complete` with (authCode, sharedId). This is PayPal's
// documented integration and matches the official @easypayment WooCommerce
// plugin. Opening the popup ourselves (a previous attempt at fixing the "opens a
// new tab" issue) stopped partner.js from receiving completion, which left the
// popup stranded on PayPal's "isuDone" page and never saved credentials.
const PARTNER_JS_URL =
  "https://www.paypal.com/webapps/merchantboarding/js/lib/lightbox/partner.js"

declare global {
  interface Window {
    PAYPAL?: {
      apps?: {
        Signup?: {
          miniBrowser?: { init?: () => void; closeFlow?: () => void }
          MiniBrowser?: { init?: () => void; closeFlow?: () => void }
        }
      }
    }
    onboardingCallback?: (authCode: string, sharedId: string) => void
  }
}

const SERVICE_URL = "/admin/paypal/onboarding-link"
const CACHE_PREFIX = "pp_onboard_cache"
const CACHE_EXPIRY = 6 * 60 * 60 * 1000 // 6 hours

const ONBOARDING_COMPLETE_ENDPOINT = "/admin/paypal/onboard-complete"
const STATUS_ENDPOINT = "/admin/paypal/status"
const SAVE_CREDENTIALS_ENDPOINT = "/admin/paypal/save-credentials"
const DISCONNECT_ENDPOINT = "/admin/paypal/disconnect"
const ENVIRONMENT_ENDPOINT = "/admin/paypal/environment"

type Env = "sandbox" | "live"

const cacheKeyFor = (env: Env) => `${CACHE_PREFIX}_${env}`

function readCachedUrl(env: Env): string | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(cacheKeyFor(env))
    if (!raw) return null
    const data = JSON.parse(raw)
    if (
      data &&
      typeof data.url === "string" &&
      Date.now() - (Number(data.ts) || 0) < CACHE_EXPIRY
    ) {
      return data.url
    }
  } catch {
    /* ignore malformed cache */
  }
  return null
}

function writeCachedUrl(env: Env, url: string) {
  try {
    localStorage.setItem(cacheKeyFor(env), JSON.stringify({ url, ts: Date.now() }))
  } catch {
    /* ignore */
  }
}

function clearCachedUrl(env?: Env) {
  try {
    if (env) {
      localStorage.removeItem(cacheKeyFor(env))
    } else {
      localStorage.removeItem(cacheKeyFor("sandbox"))
      localStorage.removeItem(cacheKeyFor("live"))
    }
  } catch {
    /* ignore */
  }
}

export default function PayPalConnectionPage() {
  const [env, setEnv] = useState<Env>("live")
  const [envReady, setEnvReady] = useState(false)

  const [connState, setConnState] = useState<
    "loading" | "ready" | "connected" | "error"
  >("loading")
  const [error, setError] = useState<string | null>(null)
  const [finalUrl, setFinalUrl] = useState<string>("")
  const [showManual, setShowManual] = useState(false)
  const [clientId, setClientId] = useState("")
  const [secret, setSecret] = useState("")
  const [statusInfo, setStatusInfo] = useState<{
    seller_client_id_masked?: string | null
    seller_client_secret_masked?: string | null
    seller_email?: string | null
  } | null>(null)

  const [onboardingInProgress, setOnboardingInProgress] = useState(false)

  const initLoaderRef = useRef<HTMLDivElement>(null)
  const paypalButtonRef = useRef<HTMLAnchorElement | null>(null)
  const errorLogRef = useRef<HTMLDivElement>(null)
  const runIdRef = useRef(0)
  const currentRunId = useRef(0)
  const completedRef = useRef(false)

  // Long-lived listeners/timers read the current env through a ref so they never
  // capture a stale value from the render that registered them.
  const envRef = useRef<Env>(env)
  envRef.current = env

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollAttemptsRef = useRef(0)

  const ppBtnMeasureRef = useRef<HTMLAnchorElement | null>(null)
  const [ppBtnWidth, setPpBtnWidth] = useState<number | null>(null)

  const canSaveManual = useMemo(() => {
    return clientId.trim().length > 0 && secret.trim().length > 0
  }, [clientId, secret])

  const showError = useCallback((msg: string) => {
    setConnState("error")
    setError(msg)
  }, [])

  // Close PayPal's mini-browser via partner.js's API (works under both the
  // `miniBrowser` and `MiniBrowser` casings PayPal has shipped over time).
  const closeMiniBrowser = useCallback(() => {
    try {
      const close1 = window.PAYPAL?.apps?.Signup?.MiniBrowser?.closeFlow
      if (typeof close1 === "function") close1()
    } catch {}
    try {
      const close2 = window.PAYPAL?.apps?.Signup?.miniBrowser?.closeFlow
      if (typeof close2 === "function") close2()
    } catch {}
  }, [])

  const stopStatusPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    pollAttemptsRef.current = 0
  }, [])

  // Fetch status for an env and, if the seller credentials are present, flip the
  // UI to "connected" and close the PayPal popup. Returns true once connected.
  const refreshStatusAndMaybeConnect = useCallback(
    async (activeEnv: Env): Promise<boolean> => {
      try {
        const res = await fetch(`${STATUS_ENDPOINT}?environment=${activeEnv}`, {
          method: "GET",
          credentials: "include",
        })
        const st = await res.json().catch(() => ({}))
        const connected =
          st?.status === "connected" && st?.seller_client_id_present === true
        if (connected) {
          completedRef.current = true
          setStatusInfo(st)
          setConnState("connected")
          setShowManual(false)
          setOnboardingInProgress(false)
          clearCachedUrl(activeEnv)
          closeMiniBrowser()
          stopStatusPolling()
        }
        return connected
      } catch {
        return false
      }
    },
    [closeMiniBrowser, stopStatusPolling]
  )

  // While a connect attempt is in flight, the seller may complete onboarding via
  // a path that never reaches the opener (e.g. partner.js fails to fire its
  // callback, or the popup's completion message is blocked). The return_url
  // bridge still saves credentials server-side, so poll status as the reliable
  // fallback: the moment credentials land, this flips to "connected" and closes
  // the stranded popup.
  const startStatusPolling = useCallback(() => {
    stopStatusPolling()
    const MAX_ATTEMPTS = 100 // ~5 min at 3s intervals
    const tick = async () => {
      pollAttemptsRef.current += 1
      const connected = await refreshStatusAndMaybeConnect(envRef.current)
      if (connected || completedRef.current) return
      if (pollAttemptsRef.current >= MAX_ATTEMPTS) {
        stopStatusPolling()
        return
      }
      pollTimerRef.current = setTimeout(tick, 3000)
    }
    pollTimerRef.current = setTimeout(tick, 3000)
  }, [refreshStatusAndMaybeConnect, stopStatusPolling])

  // Shared completion: exchange authCode/sharedId for seller credentials, then
  // close the popup and refresh status. Invoked by partner.js's onboardingCallback
  // and by the return_url bridge's postMessage. Guarded + server-idempotent so
  // redundant invocations are harmless.
  const completeOnboarding = useCallback(
    async (authCode: string, sharedId: string) => {
      if (!authCode || !sharedId) return
      if (completedRef.current) return
      completedRef.current = true

      try {
        window.onbeforeunload = null
      } catch {}

      const activeEnv: Env = envRef.current === "sandbox" ? "sandbox" : "live"

      setOnboardingInProgress(true)
      setConnState("loading")
      setError(null)

      try {
        const res = await fetch(ONBOARDING_COMPLETE_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ authCode, sharedId, env: activeEnv }),
        })

        if (!res.ok) {
          const txt = await res.text().catch(() => "")
          throw new Error(txt || `Onboarding exchange failed (${res.status})`)
        }

        closeMiniBrowser()
        clearCachedUrl(activeEnv)

        try {
          const statusRes = await fetch(
            `${STATUS_ENDPOINT}?environment=${activeEnv}`,
            { method: "GET", credentials: "include" }
          )
          const refreshedStatus = await statusRes.json().catch(() => ({}))
          setStatusInfo(refreshedStatus || null)
        } catch {}

        setConnState("connected")
        setShowManual(false)
        stopStatusPolling()
      } catch (e: any) {
        completedRef.current = false
        console.error(e)
        // The bridge may have already saved credentials server-side; if so the
        // poll will surface "connected". Don't strand the user on an error.
        setConnState("error")
        setError(e?.message || "Exchange failed while saving credentials.")
      } finally {
        setOnboardingInProgress(false)
      }
    },
    [closeMiniBrowser, stopStatusPolling]
  )

  // Bind partner.js to the connect button once it has a real onboarding URL.
  const initPartner = useCallback(() => {
    const signup = window.PAYPAL?.apps?.Signup
    const init =
      (signup?.miniBrowser && signup.miniBrowser.init) ||
      (signup?.MiniBrowser && signup.MiniBrowser.init)
    if (typeof init === "function") {
      try {
        init()
      } catch (e) {
        console.error("[paypal] partner.js init failed:", e)
      }
    }
  }, [])

  // Load partner.js once for the lifetime of the page.
  useEffect(() => {
    const existingScript = document.getElementById("paypal-partner-js")
    if (existingScript) return

    const preloadHref = PARTNER_JS_URL
    let preloadLink: HTMLLinkElement | null = null
    if (!document.head.querySelector(`link[rel="preload"][href="${preloadHref}"]`)) {
      preloadLink = document.createElement("link")
      preloadLink.rel = "preload"
      preloadLink.href = preloadHref
      preloadLink.as = "script"
      document.head.appendChild(preloadLink)
    }

    const ppScript = document.createElement("script")
    ppScript.id = "paypal-partner-js"
    ppScript.src = preloadHref
    ppScript.async = true
    document.head.appendChild(ppScript)

    return () => {
      if (preloadLink?.parentNode) preloadLink.parentNode.removeChild(preloadLink)
      if (ppScript.parentNode) ppScript.parentNode.removeChild(ppScript)
    }
  }, [])

  // Put the (cached or freshly generated) onboarding URL on the button, then wait
  // for partner.js to be present before showing the button + initializing it. The
  // button is only revealed once partner.js is ready, which is what guarantees
  // the first click opens the mini-browser popup (never a new tab).
  const activatePayPal = useCallback(
    (url: string, runId: number) => {
      if (paypalButtonRef.current) {
        paypalButtonRef.current.href = url
      }
      setFinalUrl(url)

      let attempts = 0
      const MAX_ATTEMPTS = 200 // ~10s

      const tryInit = () => {
        if (runId !== currentRunId.current) return
        if (window.PAYPAL?.apps?.Signup) {
          initPartner()
          setConnState("ready")
          return
        }
        attempts++
        if (attempts >= MAX_ATTEMPTS) {
          showError(
            "PayPal partner script failed to load. Please refresh and try again."
          )
          return
        }
        setTimeout(tryInit, 50)
      }

      tryInit()
    },
    [initPartner, showError]
  )

  const fetchFreshLink = useCallback(
    async (targetEnv: Env, runId: number) => {
      if (initLoaderRef.current) {
        const loaderText = initLoaderRef.current.querySelector("#loader-text")
        if (loaderText) loaderText.textContent = "Generating onboarding session..."
      }

      try {
        const res = await fetch(SERVICE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ products: ["PPCP"], environment: targetEnv }),
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data?.message || `Service returned ${res.status}`)
        }
        if (runId !== currentRunId.current) return

        const href = data?.onboarding_url
        if (!href) {
          showError("Onboarding URL not returned.")
          return
        }

        const url =
          href + (href.includes("?") ? "&" : "?") + "displayMode=minibrowser"

        writeCachedUrl(targetEnv, url)
        activatePayPal(url, runId)
      } catch (err: any) {
        if (runId !== currentRunId.current) return
        showError(err?.message || "Unable to connect to service.")
      }
    },
    [activatePayPal, showError]
  )

  // Resolve the server environment first.
  useEffect(() => {
    let alive = true
    fetch(ENVIRONMENT_ENDPOINT, { method: "GET", credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setEnv(d?.environment === "sandbox" ? "sandbox" : "live")
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setEnvReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // Page-load flow: connected? -> cached link? -> else generate a fresh link.
  useEffect(() => {
    if (!envReady) return

    currentRunId.current = ++runIdRef.current
    const runId = currentRunId.current

    let cancelled = false
    completedRef.current = false

    const run = async () => {
      setConnState("loading")
      setError(null)
      setFinalUrl("")

      try {
        const r = await fetch(`${STATUS_ENDPOINT}?environment=${env}`, {
          method: "GET",
          credentials: "include",
        })
        const st = await r.json().catch(() => ({}))

        if (cancelled || runId !== currentRunId.current) return

        setStatusInfo(st)

        const isConnected =
          st?.status === "connected" && st?.seller_client_id_present === true

        if (isConnected) {
          setConnState("connected")
          setShowManual(false)
          return
        }
      } catch (e) {
        console.error(e)
      }

      if (cancelled || runId !== currentRunId.current) return

      const cached = readCachedUrl(env)
      if (cached) {
        activatePayPal(cached, runId)
        return
      }

      await fetchFreshLink(env, runId)
    }

    run()

    return () => {
      cancelled = true
    }
  }, [env, envReady, fetchFreshLink, activatePayPal])

  // partner.js invokes this by name (data-paypal-onboard-complete) once PayPal
  // returns the seller's authCode + sharedId.
  useLayoutEffect(() => {
    window.onboardingCallback = (authCode: string, sharedId: string) => {
      void completeOnboarding(authCode, sharedId)
    }

    return () => {
      window.onboardingCallback = undefined
    }
  }, [completeOnboarding])

  // The return_url bridge (/store/paypal/onboard-return), which runs inside the
  // popup after PayPal redirects to it, posts its params back here. The bridge has
  // already exchanged credentials server-side, so we just refresh status to flip
  // to "connected" and close the popup. If for some reason credentials aren't yet
  // saved but PayPal forwarded an authCode/sharedId, complete it from here too.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event?.data as
        | { source?: string; params?: Record<string, string> }
        | undefined
      if (!data || data.source !== "paypal-onboarding-return") return

      const params = data.params || {}
      const authCode = params.authCode || params.auth_code
      const sharedId = params.sharedId || params.shared_id
      const activeEnv = envRef.current

      void (async () => {
        const connected = await refreshStatusAndMaybeConnect(activeEnv)
        if (!connected && authCode && sharedId) {
          await completeOnboarding(authCode, sharedId)
        }
      })()
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [completeOnboarding, refreshStatusAndMaybeConnect])

  // Always stop polling when the component unmounts.
  useEffect(() => stopStatusPolling, [stopStatusPolling])

  useLayoutEffect(() => {
    const el = ppBtnMeasureRef.current
    if (!el) return

    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width || 0)
      if (w > 0) setPpBtnWidth(w)
    }

    update()

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => update())
      ro.observe(el)
    } else {
      window.addEventListener("resize", update)
    }

    return () => {
      if (ro) ro.disconnect()
      else window.removeEventListener("resize", update)
    }
  }, [connState, env, finalUrl])

  // Only block the click while we are not ready; when ready, let the native click
  // through so partner.js can open the mini-browser. Start polling status so we
  // detect completion (and close the popup) even if no completion message reaches
  // this page.
  const handleConnectClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (connState !== "ready" || !finalUrl || onboardingInProgress) {
      e.preventDefault()
      return
    }
    completedRef.current = false
    startStatusPolling()
  }

  const handleSaveManual = async () => {
    if (!canSaveManual || onboardingInProgress) return
    setOnboardingInProgress(true)
    setConnState("loading")
    setError(null)

    try {
      const res = await fetch(SAVE_CREDENTIALS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: secret.trim(),
          environment: env,
        }),
      })

      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        throw new Error(txt || `Save credentials failed (${res.status})`)
      }

      const statusRes = await fetch(`${STATUS_ENDPOINT}?environment=${env}`, {
        method: "GET",
        credentials: "include",
      })
      const refreshedStatus = await statusRes.json().catch(() => ({}))

      setConnState("connected")
      setStatusInfo(refreshedStatus || null)
      setShowManual(false)

      clearCachedUrl(env)
    } catch (e: any) {
      console.error(e)
      setConnState("error")
      setError(e?.message || "Failed to save credentials.")
    } finally {
      setOnboardingInProgress(false)
    }
  }

  const handleDisconnect = async () => {
    if (onboardingInProgress) return
    if (!window.confirm("Disconnect PayPal for this environment?")) return

    stopStatusPolling()
    setOnboardingInProgress(true)
    setConnState("loading")
    setError(null)
    setFinalUrl("")
    setShowManual(false)
    setStatusInfo(null)

    try {
      const res = await fetch(DISCONNECT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ environment: env }),
      })

      if (!res.ok) {
        const t = await res.text().catch(() => "")
        throw new Error(t || `Disconnect failed (${res.status})`)
      }

      clearCachedUrl(env)
      completedRef.current = false

      currentRunId.current = ++runIdRef.current
      await fetchFreshLink(env, currentRunId.current)
    } catch (e: any) {
      console.error(e)
      setConnState("error")
      setError(e?.message || "Failed to disconnect.")
    } finally {
      setOnboardingInProgress(false)
    }
  }

  const handleEnvChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Env
    if (next === env || onboardingInProgress) return

    stopStatusPolling()
    completedRef.current = false
    clearCachedUrl()
    setConnState("loading")

    try {
      await fetch(ENVIRONMENT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ environment: next }),
      })
    } catch {}

    setEnv(next)
  }

  return (
    <div className="p-6">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ui-fg-base">PayPal Gateway By Easy Payment</h1>
          </div>
        </div>

        <PayPalTabs />

        <div className="rounded-xl border border-ui-border-base bg-ui-bg-base shadow-sm">
          <div className="grid grid-cols-1 gap-y-6 p-4 md:grid-cols-[260px_1fr] md:items-start">
            <div className="text-sm font-medium pt-2">Environment</div>
            <div className="max-w-xl">
              <select
                value={env}
                onChange={handleEnvChange}
                disabled={onboardingInProgress}
                className="w-full rounded-md border border-ui-border-base bg-transparent px-3 py-2 text-sm"
              >
                <option value="sandbox">Sandbox (Test Mode)</option>
                <option value="live">Live (Production)</option>
              </select>
            </div>

            <div className="text-sm font-medium pt-2">
              {env === "sandbox" ? "Connect to PayPal (Sandbox)" : "Connect to PayPal"}
            </div>

            <div className="max-w-xl">
              {connState === "connected" ? (
                <div>
                  <div className="text-sm text-green-600 bg-green-50 p-3 rounded border border-green-200">
                    ✅ Successfully connected to PayPal!
                    <a
                      data-paypal-button="true"
                      data-paypal-onboard-complete="onboardingCallback"
                      href="#"
                      style={{ display: "none" }}
                    >
                      PayPal
                    </a>
                  </div>
                  <div className="mt-3 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3 text-xs text-ui-fg-subtle">
                    <div className="font-medium text-ui-fg-base">
                      Connected PayPal account
                    </div>
                    <div className="mt-1">
                      Email:{" "}
                      <span className="font-mono text-ui-fg-base">
                        {statusInfo?.seller_email || "Unavailable"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={onboardingInProgress}
                      className="transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    ref={initLoaderRef}
                    id="init-loader"
                    className={`status-msg mb-4 ${
                      connState !== "loading" ? "hidden" : "block"
                    }`}
                  >
                    <div className="loader inline-block align-middle mr-2"></div>
                    <span id="loader-text" className="text-sm">
                      {onboardingInProgress
                        ? "Configuring connection to PayPal…"
                        : "Checking connection..."}
                    </span>
                  </div>

                  <div className={`${connState === "ready" ? "block" : "hidden"}`}>
                    <a
                      ref={(node) => {
                        paypalButtonRef.current = node
                        ppBtnMeasureRef.current = node
                      }}
                      id="paypal-button"
                      data-paypal-button="true"
                      href={finalUrl || "#"}
                      data-paypal-onboard-complete="onboardingCallback"
                      onClick={handleConnectClick}
                      className="transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none no-underline shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5"
                      style={{
                        cursor: onboardingInProgress ? "not-allowed" : "pointer",
                        opacity: onboardingInProgress ? 0.6 : 1,
                        pointerEvents: onboardingInProgress ? "none" : "auto",
                      }}
                    >
                      Connect to PayPal
                    </a>

                    <div
                      className="mt-2"
                      style={{
                        width: ppBtnWidth ? `${ppBtnWidth}px` : "auto",
                        marginTop: "20px",
                        marginBottom: "10px",
                      }}
                    >
                      <div className="flex justify-center">
                        <span className="text-[11px] text-ui-fg-muted leading-none">
                          OR
                        </span>
                      </div>
                    </div>

                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => setShowManual(!showManual)}
                        disabled={onboardingInProgress}
                        className="text-sm text-ui-fg-interactive underline whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Click here to insert credentials manually
                      </button>
                    </div>
                  </div>

                  <div className={`${connState === "ready" ? "hidden" : "block"} mt-3`}>
                    <button
                      type="button"
                      onClick={() => setShowManual(!showManual)}
                      disabled={onboardingInProgress}
                      className="text-sm text-ui-fg-interactive underline whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Click here to insert credentials manually
                    </button>
                  </div>

                  <div
                    ref={errorLogRef}
                    id="error-log"
                    className={`mt-4 text-left text-xs bg-red-50 text-red-600 p-3 border border-red-200 rounded ${
                      connState === "error" && error ? "block" : "hidden"
                    }`}
                  >
                    {error}
                  </div>
                </>
              )}
            </div>

            {showManual && (
              <div className="md:col-span-2">
                <div className="ml-[260px] max-w-xl mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="pp-manual-client-id" className="text-sm font-medium">Client ID</label>
                    <input
                      id="pp-manual-client-id"
                      type="text"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      disabled={onboardingInProgress}
                      className="rounded-md border border-ui-border-base bg-transparent px-3 py-2 text-sm disabled:opacity-50"
                      placeholder={
                        env === "sandbox" ? "Sandbox Client ID" : "Live Client ID"
                      }
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="pp-manual-secret" className="text-sm font-medium">Secret</label>
                    <input
                      id="pp-manual-secret"
                      type="password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      disabled={onboardingInProgress}
                      className="rounded-md border border-ui-border-base bg-transparent px-3 py-2 text-sm disabled:opacity-50"
                      placeholder={env === "sandbox" ? "Sandbox Secret" : "Live Secret"}
                    />
                  </div>

                  <div className="md:col-span-2 rounded-md border border-ui-border-base bg-ui-bg-subtle p-4 text-sm text-ui-fg-subtle">
                    <p className="font-medium text-ui-fg-base">
                      Get your Client ID and Secret in 3 steps:
                    </p>
                    <ol className="mt-2 list-decimal space-y-2 pl-5">
                      <li>
                        Open{" "}
                        <a
                          href="https://developer.paypal.com/dashboard/"
                          target="_blank"
                          rel="noreferrer"
                          className="text-ui-fg-interactive underline"
                        >
                          Log in to Dashboard
                        </a>{" "}
                        and sign in or create an account.
                      </li>
                      <li>Select <span className="font-medium text-ui-fg-base">Apps & Credentials</span>, then choose <span className="font-medium text-ui-fg-base">Create App</span> if you need a new project.</li>
                      <li>Copy your app's <span className="font-medium text-ui-fg-base">Client ID</span> and <span className="font-medium text-ui-fg-base">Secret</span>, paste them above, then click <span className="font-medium text-ui-fg-base">Save credentials</span>.</li>
                    </ol>
                  </div>

                  <div className="md:col-span-2 flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      className="transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5"
                      onClick={() => setShowManual(false)}
                      disabled={onboardingInProgress}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      className="transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5"
                      disabled={!canSaveManual || onboardingInProgress}
                      onClick={handleSaveManual}
                    >
                      Save credentials
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .loader {
          border: 3px solid #f3f3f3;
          border-top: 3px solid #0070ba;
          border-radius: 50%;
          width: 18px;
          height: 18px;
          animation: spin 1s linear infinite;
          display: inline-block;
          vertical-align: middle;
          margin-right: 8px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

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
  hide: true,
})


if (typeof window !== "undefined") {
  const preloadHref =
    "https://www.paypal.com/webapps/merchantboarding/js/lib/lightbox/partner.js"

  const existingPreload = document.head.querySelector(
    `link[rel="preload"][href="${preloadHref}"]`
  )
  if (!existingPreload) {
    const preloadLink = document.createElement("link")
    preloadLink.rel = "preload"
    preloadLink.href = preloadHref
    preloadLink.as = "script"
    document.head.appendChild(preloadLink)
  }

  const existingScript = document.getElementById(
    "paypal-partner-js"
  ) as HTMLScriptElement | null
  if (!existingScript) {
    const ppScript = document.createElement("script")
    ppScript.id = "paypal-partner-js"
    ppScript.src = preloadHref
    ppScript.async = true
    document.head.appendChild(ppScript)
  }
}

declare global {
  interface Window {
    PAYPAL?: {
      apps?: {
        Signup?: {
          miniBrowser?: { init: () => void }
          MiniBrowser?: { closeFlow?: () => void }
        }
      }
    }
    onboardingCallback?: (authCode: string, sharedId: string) => void
  }
}


const SERVICE_URL = "/admin/paypal/onboarding-link"
const CACHE_KEY = "pp_onboard_cache"
const RELOAD_KEY = "pp_onboard_reloaded_once"
const CACHE_EXPIRY = 10 * 60 * 1000

const ONBOARDING_COMPLETE_ENDPOINT = "/admin/paypal/onboard-complete"
const STATUS_ENDPOINT = "/admin/paypal/status"
const SAVE_CREDENTIALS_ENDPOINT = "/admin/paypal/save-credentials"
const DISCONNECT_ENDPOINT = "/admin/paypal/disconnect"

let cachedUrl: string | null = null
if (typeof window !== "undefined") {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      const data = JSON.parse(cached)
      if (new Date().getTime() - data.ts < CACHE_EXPIRY) {
        cachedUrl = data.url
      }
    }
  } catch (e) {
    console.error("Cache read error:", e)
  }
}


export default function PayPalConnectionPage() {
  const [env, setEnv] = useState<"sandbox" | "live">("live")

  useEffect(() => {
    fetch("/admin/paypal/environment", { method: "GET" })
      .then((r) => r.json())
      .then((d) => {
        const v = d?.environment === "sandbox" ? "sandbox" : "live"
        setEnv(v)
      })
      .catch(() => {})
  }, [])
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
  const paypalButtonRef = useRef<HTMLAnchorElement>(null)
  const errorLogRef = useRef<HTMLDivElement>(null)
  const runIdRef = useRef(0)
  const currentRunId = useRef(0)

  const ppBtnMeasureRef = useRef<HTMLAnchorElement | null>(null)
  const [ppBtnWidth, setPpBtnWidth] = useState<number | null>(null)

  const canSaveManual = useMemo(() => {
    return clientId.trim().length > 0 && secret.trim().length > 0
  }, [clientId, secret])

  const fetchFreshLink = useCallback(
    (runId: number) => {
      if (initLoaderRef.current) {
        const loaderText = initLoaderRef.current.querySelector("#loader-text")
        if (loaderText)
          loaderText.textContent = "Generating onboarding session..."
      }

      fetch(SERVICE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          products: ["PPCP"],
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (runId !== currentRunId.current) return

          const href = data?.onboarding_url
          if (!href) {
            showError("Onboarding URL not returned.")
            return
          }

          const finalUrl =
            href + (href.includes("?") ? "&" : "?") + "displayMode=minibrowser"

          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
              url: finalUrl,
              ts: Date.now(),
            })
          )

          if (!localStorage.getItem(RELOAD_KEY)) {
            localStorage.setItem(RELOAD_KEY, "1")
            window.location.reload()
            return
          }

          activatePayPal(finalUrl, runId)
        })
        .catch(() => {
          if (runId !== currentRunId.current) return
          showError("Unable to connect to service.")
        })
    },
    [env]
  )

  const showUI = useCallback(() => {
    const btn = document.querySelector('[data-paypal-button="true"]')
    if (btn && window.PAYPAL?.apps?.Signup?.miniBrowser?.init) {
      window.PAYPAL.apps.Signup.miniBrowser.init()
    }
    setConnState("ready")
  }, [])

  const showError = useCallback((msg: string) => {
    setConnState("error")
    setError(msg)
  }, [])

  const activatePayPal = useCallback(
    (url: string, runId: number) => {
      if (paypalButtonRef.current) {
        paypalButtonRef.current.href = url
      }
      setFinalUrl(url)

      const tryInit = () => {
        if (runId !== currentRunId.current) return
        if (window.PAYPAL?.apps?.Signup) {
          showUI()
          return
        }
        setTimeout(tryInit, 50)
      }

      tryInit()
    },
    [showUI]
  )

  useEffect(() => {
    currentRunId.current = ++runIdRef.current
    const runId = currentRunId.current

    let cancelled = false

    const run = async () => {
      setConnState("loading")
      setError(null)
      setFinalUrl("")

      try {
        const r = await fetch(`${STATUS_ENDPOINT}?environment=${env}`, {
          method: "GET",
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

      if (cachedUrl) {
        activatePayPal(cachedUrl, runId)
      } else {
        fetchFreshLink(runId)
      }
    }

    run()

    return () => {
      cancelled = true
      currentRunId.current = 0
    }
  }, [env, fetchFreshLink, activatePayPal])

  useLayoutEffect(() => {
    window.onboardingCallback = async function (authCode: string, sharedId: string) {
      try {
        ;(window as any).onbeforeunload = ""
      } catch {}

      setOnboardingInProgress(true)
      setConnState("loading")
      setError(null)

      const payload = {
        authCode,
        sharedId,
        env: env === "sandbox" ? "sandbox" : "live",
      }

      try {
        const res = await fetch(ONBOARDING_COMPLETE_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const txt = await res.text().catch(() => "")
          throw new Error(txt || `Onboarding exchange failed (${res.status})`)
        }

        try {
          const close1 = window.PAYPAL?.apps?.Signup?.MiniBrowser?.closeFlow
          if (typeof close1 === "function") close1()
        } catch {}
        try {
          const close2 =
            window.PAYPAL?.apps?.Signup?.miniBrowser &&
            (window.PAYPAL.apps.Signup.miniBrowser as any).closeFlow
          if (typeof close2 === "function") close2()
        } catch {}

        try {
          localStorage.removeItem(CACHE_KEY)
          localStorage.removeItem(RELOAD_KEY)
        } catch {}

        window.location.href = window.location.href
      } catch (e: any) {
        console.error(e)
        setConnState("error")
        setError(e?.message || "Exchange failed while saving credentials.")
        setOnboardingInProgress(false)
      }
    }

    return () => {
      window.onboardingCallback = undefined
    }
  }, [env])

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

  const handleConnectClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (connState !== "ready" || !finalUrl || onboardingInProgress) {
      e.preventDefault()
    }
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
      })
      const refreshedStatus = await statusRes.json().catch(() => ({}))

      setConnState("connected")
      setStatusInfo(refreshedStatus || null)
      setShowManual(false)

      try {
        localStorage.removeItem(CACHE_KEY)
        localStorage.removeItem(RELOAD_KEY)
      } catch {}
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

    setOnboardingInProgress(true)
    setConnState("loading")
    setError(null)
    setFinalUrl("")
    setShowManual(false)

    try {
      const res = await fetch(DISCONNECT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ environment: env }),
      })

      if (!res.ok) {
        const t = await res.text().catch(() => "")
        throw new Error(t || `Disconnect failed (${res.status})`)
      }

      try {
        localStorage.removeItem(CACHE_KEY)
        localStorage.removeItem(RELOAD_KEY)
      } catch {}

      currentRunId.current = ++runIdRef.current
      const runId = currentRunId.current
      fetchFreshLink(runId)
    } catch (e: any) {
      console.error(e)
      setConnState("error")
      setError(e?.message || "Failed to disconnect.")
    } finally {
      setOnboardingInProgress(false)
    }
  }

  const handleEnvChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as "sandbox" | "live"
    setEnv(next)
    cachedUrl = null

    try {
      await fetch("/admin/paypal/environment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ environment: next }),
      })
    } catch {}

    try {
      localStorage.removeItem(CACHE_KEY)
      localStorage.removeItem(RELOAD_KEY)
    } catch {}
  }

  return (
    <div className="p-6">
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">PayPal Gateway By Easy Payment</h1>

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
                    <label className="text-sm font-medium">Client ID</label>
                    <input
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
                    <label className="text-sm font-medium">Secret</label>
                    <input
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

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { PasswordInput } from "@/components/ui/password-input"
import { Toaster, toast } from "sonner"
import { Mail, Phone, ArrowRight, Clock, KeyRound } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { AuthHeader } from "@/components/auth-header"
import { useT } from "@/components/i18n-provider"
import {
  listBrokerages,
  listLenderInstitutions,
  signUpPartner,
  type Organization,
} from "@/lib/queries/lookups"

type UserRole = "broker" | "lender" | null

export default function SignUpPage() {
  const t = useT("signUp")
  const router = useRouter()
  const supabase = createClient()
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [role, setRole] = useState<UserRole>(null)
  const [organizationId, setOrganizationId] = useState("")
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lenderPending, setLenderPending] = useState(false)
  // Email-confirmation (code) flow — only when the deployment has confirmations on (signUp returns
  // no session). Locally confirmations are off, so signUp returns a session and this screen is skipped.
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState("")
  const [verifying, setVerifying] = useState(false)
  // Inline field errors (Create-Deal style) — replaces the old toast validation.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const clearErr = (k: string) => setErrors((e) => (e[k] ? { ...e, [k]: "" } : e))

  const [brokerages, setBrokerages] = useState<Organization[]>([])
  const [institutions, setInstitutions] = useState<Organization[]>([])

  // Load the org lists once (anon-readable via RLS, migration 18). Show a toast if it fails —
  // without them the dropdown can't be populated.
  useEffect(() => {
    let active = true
    Promise.all([listBrokerages(supabase), listLenderInstitutions(supabase)])
      .then(([b, i]) => {
        if (!active) return
        setBrokerages(b)
        setInstitutions(i)
      })
      .catch((err) => {
        if (active) toast.error(err instanceof Error ? err.message : t("errLoadOrgs"))
      })
    return () => {
      active = false
    }
  }, [supabase, t])

  const organizations = role === "broker" ? brokerages : role === "lender" ? institutions : []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    const newErrors: Record<string, string> = {}
    if (!role) newErrors.role = t("errSelectRole")
    if (!firstName.trim()) newErrors.firstName = t("errRequired")
    if (!lastName.trim()) newErrors.lastName = t("errRequired")
    if (!email.trim()) newErrors.email = t("errRequired")
    if (!phone.trim()) newErrors.phone = t("errRequired")
    if (role && !organizationId)
      newErrors.organizationId = role === "broker" ? t("errSelectBrokerage") : t("errSelectLender")
    if (!password) newErrors.password = t("errRequired")
    else if (password.length < 6) newErrors.password = t("errPwTooShort")
    if (!confirmPassword) newErrors.confirmPassword = t("errRequired")
    else if (password !== confirmPassword) newErrors.confirmPassword = t("errPwMismatch")
    if (!agreedToTerms) newErrors.terms = t("errAgreeTerms")
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    setErrors({})
    if (!role) return // unreachable (newErrors.role would be set above) — narrows the type for TS

    setIsSubmitting(true)
    try {
      const { hasSession } = await signUpPartner(supabase, {
        role,
        firstName,
        lastName,
        email,
        phone,
        password,
        organizationId,
        tosAccepted: agreedToTerms,
      })
      if (!hasSession) {
        // Deployment with email confirmations ON (hosted): no session yet — BOTH roles must confirm
        // with the 6-digit code we emailed (verifyOtp) before continuing. handleVerify then routes a
        // lender → pending-approval and a broker → deal-room. (Client feedback 2026-07-20 #12: lenders
        // were skipping this and landing on the pending screen with an UNCONFIRMED email, so they could
        // never sign in afterwards — there was nowhere to enter the code.)
        setCodeSent(true)
        setIsSubmitting(false)
      } else if (role === "lender") {
        // Confirmations OFF (local): the session is live immediately, but lenders still await manual
        // admin approval — sign them out and show the pending screen (don't drop them into an
        // RLS-denied feed).
        await supabase.auth.signOut()
        setLenderPending(true)
      } else {
        // Broker, confirmations off: active immediately.
        toast.success(t("createdWelcome"))
        router.push("/deal-room")
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errCreate"))
      setIsSubmitting(false)
    }
  }

  // Confirm the email with the 6-digit code (verifyOtp returns a live session on success).
  const handleVerify = async () => {
    if (code.length < 6 || verifying) return
    setVerifying(true)
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" })
      if (error) throw error
      if (role === "lender") {
        // Confirmed, but still awaiting admin approval — don't drop them into an RLS-denied feed.
        await supabase.auth.signOut()
        setCodeSent(false)
        setLenderPending(true)
      } else {
        toast.success(t("createdWelcome"))
        router.push("/deal-room")
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errVerify"))
      setVerifying(false)
    }
  }

  const handleResend = async () => {
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email })
      if (error) throw error
      toast.success(t("codeResent"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errResend"))
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Toaster position="top-center" richColors />

      <AuthHeader />

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center py-12 px-4">
        {lenderPending ? (
          /* Lender post-signup: pending admin approval */
          <div className="w-full max-w-md bg-card rounded-lg border border-border p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Clock className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{t("pendingTitle")}</h1>
            <p className="text-muted-foreground mb-6">
              {t("pendingBody")}
            </p>
            <Button asChild className="w-full py-6 text-base font-medium">
              <Link href="/sign-in">
                {t("backToSignIn")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        ) : codeSent ? (
          /* Post-signup: confirm the email with the 6-digit code (email confirmations on) */
          <div className="w-full max-w-md bg-card rounded-lg border border-border p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{t("verifyTitle")}</h1>
            <p className="text-muted-foreground mb-6">{t("verifyBody", { email })}</p>
            {/* Plain numeric input (not fixed slots) so it works whatever the project's Email OTP
                length is — local defaults to 6, hosted may be 8. Accepts 6–8 digits. */}
            <div className="mb-6">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                aria-label={t("verifyCta")}
                className="text-center text-2xl tracking-[0.4em] font-semibold bg-muted/50"
              />
            </div>
            <Button
              onClick={handleVerify}
              disabled={code.length < 6 || verifying}
              className="w-full py-6 text-base font-medium"
            >
              {verifying ? t("verifying") : t("verifyCta")}
              {!verifying && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
            <p className="text-sm text-muted-foreground mt-4">
              {t("noCode")}{" "}
              <button type="button" onClick={handleResend} className="text-primary font-medium hover:underline">
                {t("resendCode")}
              </button>
            </p>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">{t("title")}</h1>
            </div>

            <div className="w-full max-w-2xl bg-card rounded-lg border border-border p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Role Selection */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium">
                    {t("registeringAs")} <span className="text-destructive">*</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        setRole("broker")
                        setOrganizationId("")
                        clearErr("role")
                      }}
                      className={`flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition-all ${
                        role === "broker"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-foreground hover:border-primary/50"
                      }`}
                    >
                      <span className="font-medium">{t("broker")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRole("lender")
                        setOrganizationId("")
                        clearErr("role")
                      }}
                      className={`flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition-all ${
                        role === "lender"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-foreground hover:border-primary/50"
                      }`}
                    >
                      <span className="font-medium">{t("lender")}</span>
                    </button>
                  </div>
                  {errors.role && <p className="text-xs text-destructive">{errors.role}</p>}
                </div>

                {/* Name Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="text-sm font-medium">
                      {t("firstName")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="firstName"
                      placeholder="John"
                      value={firstName}
                      onChange={(e) => { setFirstName(e.target.value); clearErr("firstName") }}
                      aria-invalid={!!errors.firstName}
                      className="bg-muted/50"
                    />
                    {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="text-sm font-medium">
                      {t("lastName")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="lastName"
                      placeholder="Doe"
                      value={lastName}
                      onChange={(e) => { setLastName(e.target.value); clearErr("lastName") }}
                      aria-invalid={!!errors.lastName}
                      className="bg-muted/50"
                    />
                    {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">
                    {t("email")} <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="john.doe@company.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); clearErr("email") }}
                      aria-invalid={!!errors.email}
                      className="pl-10 bg-muted/50"
                    />
                  </div>
                  {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-sm font-medium">
                    {t("phone")} <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={phone}
                      onChange={(e) => { setPhone(e.target.value); clearErr("phone") }}
                      aria-invalid={!!errors.phone}
                      className="pl-10 bg-muted/50"
                    />
                  </div>
                  {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
                </div>

                {/* Organization Dropdown */}
                {role && (
                  <div className="space-y-2">
                    <Label htmlFor="organization" className="text-sm font-medium">
                      {role === "broker" ? t("brokerageName") : t("lenderName")} <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={organizationId}
                      onValueChange={(v) => { setOrganizationId(v); clearErr("organizationId") }}
                    >
                      <SelectTrigger id="organization" className="w-full bg-muted/50" aria-invalid={!!errors.organizationId}>
                        <SelectValue
                          placeholder={role === "broker" ? t("selectBrokerage") : t("selectLender")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations.map((org) => (
                          <SelectItem key={org.id} value={org.id}>
                            {org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.organizationId && <p className="text-xs text-destructive">{errors.organizationId}</p>}
                  </div>
                )}

                {/* Password Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sm font-medium">
                      {t("password")} <span className="text-destructive">*</span>
                    </Label>
                    <PasswordInput
                      id="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); clearErr("password"); clearErr("confirmPassword") }}
                      aria-invalid={!!errors.password}
                      className="bg-muted/50"
                    />
                    {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-sm font-medium">
                      {t("confirmPassword")} <span className="text-destructive">*</span>
                    </Label>
                    <PasswordInput
                      id="confirmPassword"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); clearErr("confirmPassword") }}
                      aria-invalid={!!errors.confirmPassword}
                      className="bg-muted/50"
                    />
                    {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword}</p>}
                  </div>
                </div>

                {/* Terms Checkbox */}
                <div>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="terms"
                      checked={agreedToTerms}
                      onCheckedChange={(checked) => { setAgreedToTerms(checked as boolean); clearErr("terms") }}
                      aria-invalid={!!errors.terms}
                      className="mt-0.5"
                    />
                    <label htmlFor="terms" className="text-sm text-muted-foreground leading-relaxed">
                      {t("agreePre")}
                      <Link href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline">
                        {t("termsOfService")}
                      </Link>
                      {t("and")}
                      <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline">
                        {t("privacyPolicy")}
                      </Link>
                      {t("agreePost")}
                    </label>
                  </div>
                  {errors.terms && <p className="text-xs text-destructive mt-1">{errors.terms}</p>}
                </div>

                {/* Submit Button */}
                <p className="text-xs text-muted-foreground">
                  <span className="text-destructive">*</span> {t("requiredFields")}
                </p>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full py-6 text-base font-medium ${!agreedToTerms ? "opacity-50" : ""}`}
                >
                  {isSubmitting ? t("creating") : t("createAccount")}
                  {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>

                {/* Sign In Link */}
                <p className="text-sm text-muted-foreground text-center">
                  {t("haveAccount")}
                  <Link href="/sign-in" className="text-primary font-medium hover:underline">
                    {t("signIn")}
                  </Link>
                </p>
              </form>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

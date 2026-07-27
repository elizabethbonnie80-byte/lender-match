"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Mail, Lock, ArrowRight } from "lucide-react"
import { Toaster, toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { getGateProfile } from "@/lib/queries/profile"
import { AuthHeader } from "@/components/auth-header"
import { LogoMarquee } from "@/components/logo-marquee"
import { useT } from "@/components/i18n-provider"

/** Landing route per role after sign-in. */
const HOME_BY_ROLE: Record<string, string> = {
  broker: "/deal-room",
  lender: "/lender/new-deals",
  admin: "/admin/alerts",
}

export default function SignInPage() {
  const router = useRouter()
  const supabase = createClient()
  const t = useT("signIn")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      const profile = await getGateProfile(supabase, data.user.id)
      // Lenders still awaiting (or refused) admin approval go to the holding page, not an empty feed.
      const dest =
        profile?.role === "lender" && !profile.is_approved
          ? "/pending-approval"
          : HOME_BY_ROLE[profile?.role ?? ""] ?? "/"
      router.push(dest)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("error"))
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Toaster richColors position="top-right" />
      <AuthHeader />

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center py-12 px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t("welcomeBack")}</h1>
        </div>

        <div className="w-full max-w-md bg-card rounded-lg border border-border p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">{t("email")}</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="john.doe@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10 bg-muted/50"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium">{t("password")}</Label>
                <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
                  {t("forgotPassword")}
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <PasswordInput
                  id="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pl-10 bg-muted/50"
                />
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked as boolean)}
              />
              <label htmlFor="remember" className="text-sm text-muted-foreground">
                {t("rememberMe")}
              </label>
            </div>

            {/* Submit Button */}
            <Button type="submit" disabled={isSubmitting} className="w-full py-6 text-base font-medium">
              {isSubmitting ? t("signingIn") : t("signIn")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            {/* Create Account Link */}
            <p className="text-sm text-muted-foreground text-center">
              {t("noAccount")}
              <Link href="/sign-up" className="text-primary font-medium hover:underline">
                {t("createAccount")}
              </Link>
            </p>
          </form>
        </div>

        {/* Round 3 Phase 3: admin-maintained lender logos (renders nothing until one exists) */}
        <LogoMarquee />
      </main>
    </div>
  )
}

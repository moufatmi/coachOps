"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Settings,
  LayoutDashboard,
  Users,
  ClipboardCheck,
  Goal,
  Wallet,
  CalendarDays,
  ChevronLeft,
  LogOut,
  Loader2,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeam, usePyramid } from "./pyramid-provider";
import { useAuth } from "./auth-provider";
import { useSync } from "./sync-provider";
import { SyncIndicator } from "./sync-indicator";
import LoginPage from "@/app/login/page";
import Onboarding from "./onboarding";
import { addClub } from "@/lib/offline/hierarchy";

/** Pages that operate inside a single age group. */
const GROUP_PAGES: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/teams", label: "اللاعبون", icon: Users },
  { href: "/schedule", label: "الجدول", icon: CalendarDays },
  { href: "/attendance", label: "الحضور", icon: ClipboardCheck },
  { href: "/lineup", label: "المخطط التكتيكي", icon: Goal },
  { href: "/finance", label: "المالية", icon: Wallet },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { user, ready, signOut } = useAuth();
  useSync();
  const pyramid = usePyramid();
  const { selectedTeamId, setSelectedTeamId } = useTeam();
  const [addingClub, setAddingClub] = useState(false);
  const [clubName, setClubName] = useState("");

  // Nothing behind the login screen may render until we know who is signed in.
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-emerald-600" size={28} />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  async function createClub(e: React.FormEvent) {
    e.preventDefault();
    if (!clubName.trim() || !user) return;
    const id = await addClub(user.id, clubName);
    setClubName("");
    setAddingClub(false);
    pyramid.selectClub(id);
  }

  const needsGroup = GROUP_PAGES.some((p) => pathname.startsWith(p.href));

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden md:flex w-72 shrink-0 flex-col bg-slate-900 text-white">
        <div className="border-b border-slate-800 px-4 py-4">
          <p className="text-lg font-black">CoachOps ⚽</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {pyramid.profile?.full_name?.trim() || user.email}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <SideLink href="/" icon={LayoutDashboard} label="نظرة عامة" active={pathname === "/"} />

          <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase text-slate-500">
            الأندية
          </p>

          {pyramid.tree.map(({ club, groups }) => {
            const clubActive = pyramid.selectedClubId === club.id;
            return (
              <div key={club.id} className="mb-1">
                <button
                  onClick={() => pyramid.selectClub(club.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    clubActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60",
                  )}
                >
                  <ChevronLeft
                    size={14}
                    className={cn("shrink-0 transition-transform", clubActive && "-rotate-90")}
                  />
                  <span className="truncate font-medium">{club.name}</span>
                </button>

                {clubActive && (
                  <div className="mt-1 space-y-0.5 pe-6">
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => {
                          pyramid.selectGroup(g.id);
                          setSelectedTeamId(g.id);
                        }}
                        className={cn(
                          "block w-full truncate rounded-md px-3 py-1.5 text-start text-xs transition-colors",
                          selectedTeamId === g.id
                            ? "bg-emerald-600 text-white"
                            : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
                        )}
                      >
                        {g.name}
                      </button>
                    ))}
                    {groups.length === 0 && (
                      <p className="px-3 py-1 text-xs text-slate-500">لا توجد فئات بعد</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {addingClub ? (
            <form onSubmit={createClub} className="mt-2 px-3">
              <input
                autoFocus
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                placeholder="اسم النادي"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white"
              />
              <div className="mt-1 flex gap-2">
                <button className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] text-white">
                  إضافة
                </button>
                <button
                  type="button"
                  onClick={() => setAddingClub(false)}
                  className="px-2 py-1 text-[11px] text-slate-400"
                >
                  إلغاء
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setAddingClub(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-slate-800"
            >
              <Plus size={14} /> نادي جديد
            </button>
          )}

          {pyramid.selectedGroup && (
            <>
              <p className="truncate px-3 pb-1 pt-5 text-[11px] font-semibold uppercase text-slate-500">
                {pyramid.selectedGroup.name}
              </p>
              {GROUP_PAGES.map(({ href, label, icon }) => (
                <SideLink
                  key={href}
                  href={href}
                  icon={icon}
                  label={label}
                  active={pathname.startsWith(href)}
                />
              ))}
            </>
          )}
        </div>

        <div className="border-t border-slate-800 p-2">
          <SideLink href="/settings" icon={Settings} label="الإعدادات" active={pathname === "/settings"} />
          <button
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-slate-800"
          >
            <LogOut size={15} /> تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b bg-white px-4 py-3">
          <Breadcrumb />
          <SyncIndicator />
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b bg-white px-2 py-2 md:hidden">
          <MobileLink href="/" label="نظرة عامة" active={pathname === "/"} />
          {GROUP_PAGES.map(({ href, label }) => (
            <MobileLink key={href} href={href} label={label} active={pathname.startsWith(href)} />
          ))}
          <MobileLink href="/settings" label="الإعدادات" active={pathname === "/settings"} />
        </nav>

        <main className="flex-1 p-4 md:p-8">
          {/* First run: nothing set up yet, so guide instead of showing an
              empty shell. Skipped once any club exists. */}
          {pyramid.ready && pyramid.clubs.length === 0 && (
            <Onboarding />
          )}

          {pyramid.ready && pyramid.clubs.length > 0 && needsGroup && !pyramid.selectedGroup && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <p className="font-bold">اختر فئة عمرية أولاً</p>
              <p className="mt-1 text-sm">
                هذه الصفحة تعمل داخل فئة محددة. أضف فئة من الإعدادات إن لم توجد.
              </p>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

function SideLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
        active ? "bg-emerald-600 text-white" : "text-slate-300 hover:bg-slate-800",
      )}
    >
      <Icon size={16} />
      {label}
    </Link>
  );
}

function MobileLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "whitespace-nowrap rounded-full px-3 py-1.5 text-xs",
        active ? "bg-emerald-600 text-white" : "border bg-white text-slate-600",
      )}
    >
      {label}
    </Link>
  );
}

/** Coach ▸ club ▸ age group ▸ page: always shows where you are in the pyramid. */
function Breadcrumb() {
  const pathname = usePathname() ?? "/";
  const { profile, selectedClub, selectedGroup } = usePyramid();
  const page = GROUP_PAGES.find((p) => pathname.startsWith(p.href))?.label;

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm">
      <span className="truncate font-semibold">{profile?.full_name?.trim() || "المدرب"}</span>
      {selectedClub && (
        <>
          <span className="text-slate-300">▸</span>
          <span className="truncate text-slate-600">{selectedClub.name}</span>
        </>
      )}
      {selectedGroup && (
        <>
          <span className="text-slate-300">▸</span>
          <span className="truncate text-slate-600">{selectedGroup.name}</span>
        </>
      )}
      {page && (
        <>
          <span className="text-slate-300">▸</span>
          <span className="truncate text-emerald-700">{page}</span>
        </>
      )}
    </div>
  );
}
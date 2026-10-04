"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Settings,
  LayoutDashboard,
  Users,
  ClipboardCheck,
  Wallet,
  CalendarDays,
  ChevronLeft,
  LogOut,
  Loader2,
  Plus,
  Archive,
  Trophy,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeam, usePyramid } from "./pyramid-provider";
import { useAuth } from "./auth-provider";
import { useSync } from "./sync-provider";
import { SyncIndicator } from "./sync-indicator";
import { useMode } from "./mode-provider";
import LoginPage from "@/app/login/page";
import Onboarding from "./onboarding";
import { addClub } from "@/lib/offline/hierarchy";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Training is the week: plan sessions, mark who turned up, collect money.
 * Match is match day: pick the XI, run the clock, record the result. They are
 * separate modes rather than one long menu because they are different jobs, and a
 * coach at the touchline should not have to scroll past subscriptions to reach
 * the lineup.
 */
const TRAINING_PAGES: NavItem[] = [
  { href: "/", label: "نظرة عامة", icon: LayoutDashboard },
  { href: "/teams", label: "اللاعبون", icon: Users },
  { href: "/schedule", label: "الجدول", icon: CalendarDays },
  { href: "/attendance", label: "الحضور", icon: ClipboardCheck },
  { href: "/finance", label: "المالية", icon: Wallet },
  { href: "/archives", label: "الأرشيف", icon: Archive },
];

const MATCH_PAGES: NavItem[] = [
  { href: "/lineup", label: "مركز المباراة", icon: Trophy },
  { href: "/archives", label: "الأرشيف", icon: Archive },
];

/**
 * Pages that operate inside a single age group. The overview and the archive
 * are deliberately absent: both are coach-wide, and hiding the archive until a
 * group is picked would hide most of a coach's own history.
 */
const GROUP_PAGES = ["/teams", "/schedule", "/attendance", "/finance", "/lineup"];

/** Nav items shown regardless of whether an age group is selected. */
const GLOBAL_HREFS = new Set(["/", "/archives"]);

/**
 * Every page, in both modes. Used only for breadcrumb labels, which must resolve
 * a name even when the page is not in the current mode's menu (e.g. after
 * switching to match mode while sitting on the finance page).
 */
const ALL_PAGES: NavItem[] = [...TRAINING_PAGES, ...MATCH_PAGES];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { user, ready, signOut } = useAuth();
  useSync();
  const pyramid = usePyramid();
  const { mode, setMode } = useMode();
  const { selectedTeamId, setSelectedTeamId } = useTeam();
  const [addingClub, setAddingClub] = useState(false);
  const [clubName, setClubName] = useState("");

  const pages = mode === "match" ? MATCH_PAGES : TRAINING_PAGES;

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
    const id = String(await addClub(user.id, clubName));
    setClubName("");
    setAddingClub(false);
    pyramid.selectClub(id);
  }

  const needsGroup = GROUP_PAGES.some((p) => pathname.startsWith(p));

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
          {/*
            Mode switch. Two big targets at the top of the sidebar, in the spirit
            of a football game's main menu, because switching context should not
            require finding a link.
          */}
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-800 p-1">
            <ModeButton
              active={mode === "training"}
              onClick={() => setMode("training")}
              icon={GraduationCap}
              label="التدريب"
            />
            <ModeButton
              active={mode === "match"}
              onClick={() => setMode("match")}
              icon={Trophy}
              label="المباراة"
            />
          </div>

          {pages.map(({ href, label, icon }) => {
            // Group-scoped pages only appear once a group is chosen; the overview
            // and archive work for the whole coach.
            if (!GLOBAL_HREFS.has(href) && !pyramid.selectedGroup) return null;
            return (
              <SideLink
                key={href}
                href={href}
                icon={icon}
                label={label}
                active={href === "/" ? pathname === "/" : pathname.startsWith(href)}
              />
            );
          })}

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
          <button
            onClick={() => setMode("training")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium",
              mode === "training" ? "bg-emerald-600 text-white" : "border bg-white text-slate-600",
            )}
          >
            التدريب
          </button>
          <button
            onClick={() => setMode("match")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium",
              mode === "match" ? "bg-emerald-600 text-white" : "border bg-white text-slate-600",
            )}
          >
            المباراة
          </button>
          <span className="w-px shrink-0 bg-slate-200" />
          {pages.map(({ href, label }) =>
            !GLOBAL_HREFS.has(href) && !pyramid.selectedGroup ? null : (
              <MobileLink
                key={href}
                href={href}
                label={label}
                active={href === "/" ? pathname === "/" : pathname.startsWith(href)}
              />
            ),
          )}
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

/** One of the two large mode targets at the top of the sidebar. */
function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg py-2 text-[11px] font-bold transition-colors",
        active ? "bg-emerald-600 text-white" : "text-slate-400 hover:bg-slate-700 hover:text-slate-200",
      )}
    >
      <Icon size={17} />
      {label}
    </button>
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
  const { mode } = useMode();
  const page = ALL_PAGES.find((p) => pathname.startsWith(p.href))?.label;

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
      <span
        className={cn(
          "ms-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
          mode === "match" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
        )}
      >
        {mode === "match" ? "وضع المباراة" : "وضع التدريب"}
      </span>
    </div>
  );
}
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  getState,
  enterDevMode,
  exitDevMode,
  unlockLink,
  countVisit,
  saveLink,
  deleteLink,
  reorderLinks,
  importLinks,
  type PublicLink,
} from "@/lib/bridge.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "الجسر · بوابة روابطي" },
      {
        name: "description",
        content: "بوابة بسيطة تنقلك للموقع الذي تختاره، مع أقفال للمواقع الخاصة وأوصاف منظمة.",
      },
      { property: "og:title", content: "الجسر · بوابة روابطي" },
      {
        property: "og:description",
        content: "بوابة بسيطة تنقلك للموقع الذي تختاره، مع أقفال للمواقع الخاصة وأوصاف منظمة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BridgePage,
});

type Draft = {
  id?: string;
  title: string;
  url: string;
  icon_url: string;
  public_description: string;
  private_note: string;
  lock_password: string;
  category: string;
};

const emptyDraft: Draft = {
  title: "",
  url: "",
  icon_url: "",
  public_description: "",
  private_note: "",
  lock_password: "",
  category: "",
};

function faviconFor(link: PublicLink) {
  if (link.icon_url) return link.icon_url;
  const source = link.url;
  if (!source) return null;
  try {
    const host = new URL(source).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch {
    return null;
  }
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card-surface max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-secondary"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-input bg-secondary/40 px-3 py-2.5 text-sm outline-none transition-colors focus:border-ring";

function BridgePage() {
  const queryClient = useQueryClient();
  const fetchState = useServerFn(getState);
  const { data, isLoading } = useQuery({
    queryKey: ["bridge-state"],
    queryFn: () => fetchState(),
  });

  const enterDev = useServerFn(enterDevMode);
  const exitDev = useServerFn(exitDevMode);
  const unlock = useServerFn(unlockLink);
  const visit = useServerFn(countVisit);
  const save = useServerFn(saveLink);
  const remove = useServerFn(deleteLink);
  const reorder = useServerFn(reorderLinks);
  const importer = useServerFn(importLinks);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["bridge-state"] });

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [devPassword, setDevPassword] = useState("");
  const [devError, setDevError] = useState(false);
  const [editor, setEditor] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lockTarget, setLockTarget] = useState<PublicLink | null>(null);
  const [lockPassword, setLockPassword] = useState("");
  const [lockError, setLockError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PublicLink | null>(null);
  const dragIndex = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isDev = data?.isDev ?? false;
  const links = useMemo(() => data?.links ?? [], [data]);

  const categories = useMemo(
    () => Array.from(new Set(links.map((l) => l.category).filter(Boolean) as string[])),
    [links],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return links.filter((l) => {
      if (category && l.category !== category) return false;
      if (!q) return true;
      return (
        l.title.toLowerCase().includes(q) ||
        (l.public_description ?? "").toLowerCase().includes(q) ||
        (l.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [links, search, category]);

  const canDrag = isDev && !search.trim() && !category;

  const openLink = async (link: PublicLink) => {
    if (link.locked && !link.unlocked) {
      setLockTarget(link);
      setLockPassword("");
      setLockError(false);
      return;
    }
    if (!link.url) return;
    window.open(link.url, "_blank", "noopener,noreferrer");
    await visit({ data: { id: link.id } });
    refresh();
  };

  const submitDev = useMutation({
    mutationFn: async () => enterDev({ data: { password: devPassword } }),
    onSuccess: (res) => {
      if (res.ok) {
        setDevOpen(false);
        setDevPassword("");
        setDevError(false);
        refresh();
      } else {
        setDevError(true);
      }
    },
  });

  const submitUnlock = useMutation({
    mutationFn: async () =>
      unlock({ data: { id: lockTarget!.id, password: lockPassword } }),
    onSuccess: async (res) => {
      if (res.ok && res.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
        await visit({ data: { id: lockTarget!.id } });
        setLockTarget(null);
        refresh();
      } else {
        setLockError(true);
      }
    },
  });

  const submitSave = useMutation({
    mutationFn: async (draft: Draft) =>
      save({
        data: {
          ...(draft.id ? { id: draft.id } : {}),
          title: draft.title,
          url: draft.url,
          icon_url: draft.icon_url,
          public_description: draft.public_description,
          private_note: draft.private_note,
          lock_password: draft.lock_password,
          category: draft.category,
        },
      }),
    onSuccess: () => {
      setEditor(null);
      setFormError(null);
      refresh();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const handleExport = () => {
    const payload = links.map((l) => ({
      title: l.title,
      url: l.url,
      icon_url: l.icon_url,
      public_description: l.public_description,
      private_note: l.private_note ?? null,
      lock_password: l.lock_password ?? null,
      category: l.category,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bridge-links.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImport = async (file: File) => {
    try {
      const items = JSON.parse(await file.text());
      if (!Array.isArray(items)) throw new Error("bad");
      await importer({ data: { items } });
      refresh();
    } catch {
      setFormError("الملف غير صالح");
    }
  };

  const onDrop = async (targetIndex: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === targetIndex) return;
    const ordered = [...links];
    const moved = ordered.splice(from, 1)[0];
    if (!moved) return;
    ordered.splice(targetIndex, 0, moved);
    queryClient.setQueryData(["bridge-state"], { ...data, links: ordered });
    await reorder({ data: { ids: ordered.map((l) => l.id) } });
    refresh();
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-10 text-center">
        <span className="inline-block rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-muted-foreground">
          بوابة الانتقال
        </span>
        <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">الجسر</h1>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          اختر الموقع الذي تريد الانتقال إليه
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث عن موقع…"
          className={inputClass}
        />
        {isDev ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setFormError(null);
                setEditor({ ...emptyDraft });
              }}
              className="btn-primary hover:btn-primary-hover rounded-xl px-4 py-2.5 text-sm whitespace-nowrap"
            >
              + موقع جديد
            </button>
            <button
              onClick={handleExport}
              className="rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-sm whitespace-nowrap transition-colors hover:bg-secondary"
            >
              تصدير
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-sm whitespace-nowrap transition-colors hover:bg-secondary"
            >
              استيراد
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImport(file);
                e.target.value = "";
              }}
            />
          </div>
        ) : null}
      </div>

      {categories.length ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setCategory(null)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
              category === null
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-secondary/40 text-muted-foreground hover:bg-secondary"
            }`}
          >
            الكل
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                category === c
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-secondary/40 text-muted-foreground hover:bg-secondary"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}

      {isDev ? (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm">
          <span className="font-semibold text-primary">وضع المطور مفعّل</span>
          <button
            onClick={async () => {
              await exitDev({});
              refresh();
            }}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            خروج
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <p className="py-20 text-center text-muted-foreground">جارٍ التحميل…</p>
      ) : visible.length === 0 ? (
        <p className="py-20 text-center text-muted-foreground">لا توجد مواقع بعد.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((link, index) => {
            const icon = faviconFor(link);
            return (
              <div
                key={link.id}
                draggable={canDrag}
                onDragStart={() => {
                  dragIndex.current = index;
                }}
                onDragOver={(e) => canDrag && e.preventDefault()}
                onDrop={() => canDrag && void onDrop(index)}
                className="card-surface group relative flex flex-col rounded-2xl p-5 transition-transform hover:-translate-y-0.5"
              >
                <button
                  onClick={() => void openLink(link)}
                  className="flex-1 text-right"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary/60">
                      {icon ? (
                        <img src={icon} alt="" className="size-7 object-contain" />
                      ) : (
                        <span className="text-lg font-bold text-muted-foreground">
                          {link.title.slice(0, 1)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-bold">{link.title}</h3>
                      {link.category ? (
                        <span className="text-xs text-muted-foreground">{link.category}</span>
                      ) : null}
                    </div>
                    {link.locked ? (
                      <span className="mr-auto text-sm" title="محمي بكلمة مرور">
                        🔒
                      </span>
                    ) : null}
                  </div>

                  {link.public_description ? (
                    <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                      {link.public_description}
                    </p>
                  ) : null}

                  {isDev && link.private_note ? (
                    <p className="mt-3 rounded-lg border border-primary/30 bg-primary/10 p-2 text-xs text-primary">
                      ملاحظة خاصة: {link.private_note}
                    </p>
                  ) : null}
                </button>

                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                  <span>{link.visits} زيارة</span>
                  {isDev ? (
                    <div className="flex items-center gap-3">
                      {canDrag ? <span title="اسحب للترتيب">⠿</span> : null}
                      <button
                        onClick={() => {
                          setFormError(null);
                          setEditor({
                            id: link.id,
                            title: link.title,
                            url: link.url ?? "",
                            icon_url: link.icon_url ?? "",
                            public_description: link.public_description ?? "",
                            private_note: link.private_note ?? "",
                            lock_password: link.lock_password ?? "",
                            category: link.category ?? "",
                          });
                        }}
                        className="hover:text-foreground"
                      >
                        تعديل
                      </button>
                      <button
                        onClick={() => setConfirmDelete(link)}
                        className="text-destructive hover:brightness-125"
                      >
                        حذف
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="mt-16 flex items-center justify-center gap-2 pb-6 text-xs text-muted-foreground">
        <span>الجسر</span>
        <button
          onClick={() => {
            setDevError(false);
            setDevOpen(true);
          }}
          aria-label="وضع المطور"
          className="opacity-30 transition-opacity hover:opacity-100"
        >
          •
        </button>
      </footer>

      {devOpen ? (
        <Modal title="وضع المطور" onClose={() => setDevOpen(false)}>
          <Field label="كلمة المرور">
            <input
              type="password"
              autoFocus
              value={devPassword}
              onChange={(e) => setDevPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitDev.mutate()}
              className={inputClass}
            />
          </Field>
          {devError ? (
            <p className="mb-3 text-sm text-destructive">كلمة المرور غير صحيحة</p>
          ) : null}
          <button
            onClick={() => submitDev.mutate()}
            className="btn-primary hover:btn-primary-hover w-full rounded-xl py-2.5 text-sm"
          >
            دخول
          </button>
        </Modal>
      ) : null}

      {lockTarget ? (
        <Modal title={`${lockTarget.title} — موقع محمي`} onClose={() => setLockTarget(null)}>
          <Field label="كلمة مرور الموقع">
            <input
              type="password"
              autoFocus
              value={lockPassword}
              onChange={(e) => setLockPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitUnlock.mutate()}
              className={inputClass}
            />
          </Field>
          {lockError ? (
            <p className="mb-3 text-sm text-destructive">كلمة المرور غير صحيحة</p>
          ) : null}
          <button
            onClick={() => submitUnlock.mutate()}
            className="btn-primary hover:btn-primary-hover w-full rounded-xl py-2.5 text-sm"
          >
            فتح الموقع
          </button>
        </Modal>
      ) : null}

      {confirmDelete ? (
        <Modal title="تأكيد الحذف" onClose={() => setConfirmDelete(null)}>
          <p className="mb-6 text-sm text-muted-foreground">
            هل أنت متأكد من حذف «{confirmDelete.title}»؟ لا يمكن التراجع عن هذه الخطوة.
          </p>
          <div className="flex gap-3">
            <button
              onClick={async () => {
                await remove({ data: { id: confirmDelete.id } });
                setConfirmDelete(null);
                refresh();
              }}
              className="flex-1 rounded-xl bg-destructive py-2.5 text-sm font-bold text-destructive-foreground"
            >
              نعم، احذف
            </button>
            <button
              onClick={() => setConfirmDelete(null)}
              className="flex-1 rounded-xl border border-border bg-secondary/40 py-2.5 text-sm"
            >
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {editor ? (
        <Modal
          title={editor.id ? "تعديل الموقع" : "موقع جديد"}
          onClose={() => setEditor(null)}
        >
          <Field label="الاسم">
            <input
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="الرابط" hint="يبدأ بـ https://">
            <input
              dir="ltr"
              value={editor.url}
              onChange={(e) => setEditor({ ...editor, url: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="رابط الأيقونة (اختياري)" hint="اتركه فارغاً لاستخدام أيقونة الموقع تلقائياً">
            <input
              dir="ltr"
              value={editor.icon_url}
              onChange={(e) => setEditor({ ...editor, icon_url: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="التصنيف (اختياري)">
            <input
              value={editor.category}
              onChange={(e) => setEditor({ ...editor, category: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="الوصف العام" hint="يظهر لأي زائر">
            <textarea
              rows={2}
              value={editor.public_description}
              onChange={(e) => setEditor({ ...editor, public_description: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="الوصف الخاص" hint="يظهر لك فقط في وضع المطور">
            <textarea
              rows={2}
              value={editor.private_note}
              onChange={(e) => setEditor({ ...editor, private_note: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="قفل الموقع (اختياري)" hint="اتركه فارغاً ليكون الموقع مفتوحاً للجميع">
            <input
              value={editor.lock_password}
              onChange={(e) => setEditor({ ...editor, lock_password: e.target.value })}
              className={inputClass}
            />
          </Field>
          {formError ? <p className="mb-3 text-sm text-destructive">{formError}</p> : null}
          <button
            onClick={() => submitSave.mutate(editor)}
            disabled={submitSave.isPending}
            className="btn-primary hover:btn-primary-hover w-full rounded-xl py-2.5 text-sm disabled:opacity-60"
          >
            حفظ
          </button>
        </Modal>
      ) : null}
    </div>
  );
}

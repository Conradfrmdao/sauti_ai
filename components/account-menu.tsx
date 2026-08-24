"use client";

import {
  ChevronUp,
  LogOut,
} from "lucide-react";

import {
  useEffect,
  useRef,
  useState,
} from "react";

type AccountMenuProps = {
  name: string;
  role: string;
  initials: string;
};

export function AccountMenu({
  name,
  role,
  initials,
}: AccountMenuProps) {
  const [
    open,
    setOpen,
  ] = useState(false);

  const menuRef =
    useRef<HTMLDivElement>(
      null
    );

  /* =========================================================
     CLOSE MENU WHEN USER CLICKS OUTSIDE
  ========================================================= */

  useEffect(() => {
    function handleClickOutside(
      event: MouseEvent
    ) {
      if (
        menuRef.current &&
        !menuRef.current.contains(
          event.target as Node
        )
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );
    };
  }, []);

  return (
    <div
      ref={menuRef}
      className="relative mt-auto"
    >
      {/* =====================================================
          DROPDOWN
      ===================================================== */}

      {open && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 overflow-hidden rounded-[14px] border border-[#e4e8ef] bg-white p-1.5 shadow-[0_18px_50px_rgba(15,29,59,0.14)]">

          {/* Account info */}

          <div className="px-2.5 pb-2 pt-1.5">
            <div className="text-[10px] font-bold text-[#17223b]">
              {name}
            </div>

            <div className="mt-0.5 text-[8px] text-[#8a93a3]">
              {role}
            </div>
          </div>

          <div className="h-px bg-[#edf0f4]" />

          {/* =================================================
              LOG OUT
          ================================================= */}

          <form
            action="/auth/signout"
            method="post"
          >
            <button
              type="submit"
              className="flex h-9 w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[10px] font-semibold text-[#ba4943] transition hover:bg-[#fff3f2]"
            >
              <LogOut
                size={14}
                strokeWidth={1.8}
              />

              Log out
            </button>
          </form>
        </div>
      )}

      {/* =====================================================
          ACCOUNT BUTTON
      ===================================================== */}

      <button
        type="button"
        onClick={() =>
          setOpen(
            (current) =>
              !current
          )
        }
        className="flex w-full items-center gap-2.5 rounded-[14px] border border-[#e6eaf1] bg-white px-2.5 py-2 text-left transition hover:border-[#d8dee8] hover:bg-[#fbfcfd]"
      >
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#102652] to-[#526cff] text-[8px] font-bold text-white">
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-bold text-[#17223b]">
            {name}
          </div>

          <div className="truncate text-[8px] text-[#80899b]">
            {role}
          </div>
        </div>

        <ChevronUp
          size={13}
          className={`shrink-0 text-[#8790a0] transition-transform ${
            open
              ? "rotate-180"
              : ""
          }`}
        />
      </button>
    </div>
  );
}

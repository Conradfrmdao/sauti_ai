type SkeletonVariant = "page" | "chat" | "voice" | "auth" | "workspace";

function Line({ width = "100%", height = 12 }: { width?: string; height?: number }) {
  return <span className="skeleton-block" style={{ width, height }} />;
}

function ShellNavigation() {
  return (
    <aside className="skeleton-sidebar" aria-hidden="true">
      <Line width="112px" height={26} />
      <div className="skeleton-nav-list">
        {Array.from({ length: 7 }, (_, index) => <Line key={index} height={42} />)}
      </div>
      <Line height={54} />
    </aside>
  );
}

function MobileChrome() {
  return (
    <>
      <div className="skeleton-mobile-head" aria-hidden="true">
        <Line width="92px" height={22} />
        <Line width="40px" height={40} />
      </div>
      <div className="skeleton-mobile-tabs" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <Line key={index} width="38px" height={38} />)}
      </div>
    </>
  );
}

export function LoadingSkeleton({ variant = "page" }: { variant?: SkeletonVariant }) {
  if (variant === "auth") {
    return (
      <div className="skeleton-auth" aria-label="Loading account screen" role="status">
        <div className="skeleton-auth-brand" aria-hidden="true">
          <Line width="112px" height={27} />
          <div><Line width="72%" height={46} /><Line width="58%" height={14} /></div>
        </div>
        <div className="skeleton-auth-form" aria-hidden="true">
          <Line width="120px" height={12} />
          <Line width="270px" height={34} />
          <Line width="100%" height={44} />
          <Line width="100%" height={48} />
          <Line width="100%" height={48} />
          <Line width="100%" height={46} />
        </div>
      </div>
    );
  }

  return (
    <div className="skeleton-screen" aria-label="Loading screen" role="status">
      <ShellNavigation />
      <main className={`skeleton-content ${variant}`} aria-hidden="true">
        <MobileChrome />
        {variant === "chat" ? (
          <div className="skeleton-chat">
            <Line width="180px" height={30} />
            <Line width="62%" height={12} />
            <div className="skeleton-chat-thread">
              <Line width="68%" height={62} />
              <Line width="54%" height={54} />
              <Line width="72%" height={72} />
            </div>
            <Line height={60} />
          </div>
        ) : variant === "voice" ? (
          <div className="skeleton-voice">
            <Line width="150px" height={13} />
            <span className="skeleton-block skeleton-voice-core" />
            <Line width="220px" height={14} />
            <Line width="280px" height={52} />
          </div>
        ) : (
          <div className="skeleton-page">
            <Line width="210px" height={32} />
            <Line width="62%" height={13} />
            <div className="skeleton-summary-grid">
              {Array.from({ length: variant === "workspace" ? 4 : 3 }, (_, index) => (
                <div key={index}><Line width="42%" height={11} /><Line width="70%" height={24} /></div>
              ))}
            </div>
            <div className="skeleton-list">
              {Array.from({ length: 5 }, (_, index) => <Line key={index} height={64} />)}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

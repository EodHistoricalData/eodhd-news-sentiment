// AI Feature UI Components — reusable button and result card

// AIFeatureButton — gradient button with token cost badge
// `feature`: the token key it is charged as; the label then says the price
// ("Get AI Verdict · 3 tokens"). What-If passed it and nothing showed it.
// `disabled`: not available here; without it the button is as it always was.
window.AIFeatureButton = ({ label, icon, tokenCost, onClick, loading, isDark, style, feature, disabled }) => {
  const C3 = window.C3;
  const useFeatureCost = (() => null);
  const cost = useFeatureCost(feature || null);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); window.Haptics?.medium(); onClick?.(); }}
      disabled={loading || disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 18px',
        borderRadius: 12,
        background: loading ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)') : C3.logoGradient,
        border: 'none', color: 'white',
        fontSize: 13, fontWeight: 600,
        cursor: loading ? 'wait' : disabled ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : disabled ? 0.5 : 1,
        position: 'relative',
        ...style,
      }}
    >
      {loading ? (
        <div style={{
          width: 14, height: 14,
          border: '2px solid rgba(255,255,255,0.3)',
          borderTopColor: 'white',
          borderRadius: '50%',
          animation: 'spin .8s linear infinite',
        }} />
      ) : icon ? (
        window.IconPaths?.[icon] ? React.createElement(window.Icon || 'span', { name: icon, size: 16, color: 'white' })
          // An icon name with no path ("scale") printed as text on the button
          // ("scale Get Rebalancing Advice"). Only an
          // emoji or symbol is shown as itself.
          : (/^[a-z][A-Za-z0-9]*$/.test(String(icon)) ? null : <span style={{ fontSize: 14 }}>{icon}</span>)
      ) : null}
      <span>{loading ? 'Analyzing...' : (cost ? `${label} · ${cost}` : label)}</span>
    </button>
  );
};

// AIResultCard — glass card with markdown-rendered content
window.AIResultCard = ({ content, onDismiss, onCopy, isDark, title }) => {
  const C3 = window.C3;
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    if (content) {
      navigator.clipboard?.writeText(content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        onCopy?.();
      });
    }
  };

  return (
    <div style={{
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderRadius: 16, padding: 16, marginTop: 12,
      border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 700,
            padding: '3px 8px', borderRadius: 6,
            background: C3.logoGradient, color: 'white',
          }}>AI</span>
          {title && <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleCopy} style={{
            background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
            border: 'none', borderRadius: 8, padding: '6px 10px',
            fontSize: 11, color: isDark ? C3.textDark : C3.textLightTheme,
            cursor: 'pointer', fontWeight: 600,
          }}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {onDismiss && (
            <button onClick={onDismiss} style={{
              background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
              border: 'none', borderRadius: 8, padding: '6px 10px',
              fontSize: 11, color: isDark ? C3.textDark : C3.textLightTheme,
              cursor: 'pointer', fontWeight: 600,
            }}>
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        {window.renderMarkdown ? window.renderMarkdown(content) : content}
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 12, paddingTop: 8,
        borderTop: '1px solid ' + (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
        fontSize: 10, opacity: 0.4, textAlign: 'right',
      }}>
        AI-generated — not financial advice
      </div>
    </div>
  );
};

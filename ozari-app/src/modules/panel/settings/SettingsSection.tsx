/**
 * The two-column scaffold every settings section shares: a title + description column on the
 * left, and the content card on the right. On narrow screens the two stack (title above card).
 *
 * The card uses the app's `rounded-card` surface language (16px, hairline border, soft shadow) —
 * matching the header menu and auth cards — with the horizontal padding here so inner rows only
 * own their vertical spacing.
 */
const SettingsSection: React.FC<{
  title: string;
  description: string;
  /** Optional muted tag beside the title (e.g. "Próximamente" while a section's actions are pending). */
  badge?: string;
  children: React.ReactNode;
}> = ({ title, description, badge, children }) => (
  // `reveal-block` marks the whole section (label + card) as ONE entrance unit — the settings
  // entrance moves only these few blocks, not every element inside them.
  // Both columns need `min-w-0`: grid items default to `min-width: auto`, so without it a long
  // unbreakable value inside (a full name, an email) propagates its untruncated width up through
  // the section and pushes the whole page wider than a phone viewport — the inner `truncate`s only
  // work when every grid/flex ancestor is allowed to shrink.
  <section className="reveal-block grid gap-x-8 gap-y-4 md:grid-cols-3">
    <div className="min-w-0 md:col-span-1">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-charcoal">{title}</h2>
        {badge && (
          <span className="rounded-chip bg-charcoal/[0.05] px-2 py-0.5 text-[11px] font-medium text-charcoal/45">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-charcoal/55">{description}</p>
    </div>
    <div className="min-w-0 md:col-span-2">
      <div className="rounded-card border border-charcoal/[0.07] bg-white px-5 shadow-sm sm:px-6">{children}</div>
    </div>
  </section>
);

export default SettingsSection;

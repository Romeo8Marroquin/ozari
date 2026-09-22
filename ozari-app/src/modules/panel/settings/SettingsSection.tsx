/**
 * The two-column scaffold every settings section shares: a title + description column on the
 * left, and the content card on the right. When there isn't room for both, the two stack (title
 * above card).
 *
 * ⚠️ **"Room" is measured on the SECTION, not on the window** (`@container` on the wrapper +
 * `@min-[48rem]:` on the grid). This screen sits inside `main`, beside a sidebar the user can
 * expand to 256px, inside a padded, clamped page — so the window's width says very little about
 * this section's. A `md:grid-cols-3` (the version the owner reported at 793px, 2026-09-21) split a
 * ~490px section into a 152px label column and a 306px card: the section description came out three
 * words per line and the card's rows had no room to be rows at all. 48rem is the width at which the
 * thirds are still two real columns (≥256px of label, ≥490px of card); below it, stacking gives the
 * card every pixel of the section instead.
 *
 * The card is a container in its own right, which is what lets its contents — `SettingRow`, the
 * preferences field grids — respond to the CARD's width for the same reason. Nesting is deliberate:
 * a query inside the card asks about the card, and a query on the grid asks about the section.
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
  // entrance moves only these few blocks, not every element inside them. It rides the SAME element
  // as `@container` on purpose: a container query can never read the element it is written on, so
  // the grid below needs an ancestor to measure, and this wrapper is it.
  <div className="reveal-block @container">
    {/* Both columns need `min-w-0`: grid items default to `min-width: auto`, so without it a long
        unbreakable value inside (a full name, an email) propagates its untruncated width up through
        the section and pushes the whole page wider than a phone viewport — the inner `truncate`s
        only work when every grid/flex ancestor is allowed to shrink. */}
    <section className="grid gap-x-8 gap-y-4 @min-[48rem]:grid-cols-3">
      <div className="min-w-0 @min-[48rem]:col-span-1">
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
      <div className="min-w-0 @min-[48rem]:col-span-2">
        <div className="@container rounded-card border border-charcoal/[0.07] bg-white px-5 shadow-sm sm:px-6">
          {children}
        </div>
      </div>
    </section>
  </div>
);

export default SettingsSection;

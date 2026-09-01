import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { HiOutlineArrowPath } from 'react-icons/hi2';
import Button from '@components/Button';
import { SECTION_REVEAL_STEP, staggerIn, staggerInNested, staggerOut } from '../pageMotion';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import ProductsStatus from '../products/ProductsStatus';
import SectionReveal from '../products/SectionReveal';
import SettingsSection from '../settings/SettingsSection';
import PreferenceCatalogCard from './PreferenceCatalogCard';
import PreferenceSettingsCard from './PreferenceSettingsCard';
import PreferenceTabs from './PreferenceTabs';
import {
  activePreferenceTab,
  preferenceTabSearch,
  PREFERENCE_TABS,
  type PreferencesSearch,
  type PreferenceTab,
} from './preferencesSearch';
import { settingsInGroup, usePreferences } from './usePreferences';
import type { CatalogKey, LookupRow, PreferenceCatalogs } from './preference.types';

const KEY = 'modules.panel.preferences';
const SECONDARY_COLOR = '#262626';

/** A shimmering line — the skeleton's only primitive, same as every other screen here. */
const Bar: React.FC<{ w: string; h?: string }> = ({ w, h = 'h-3.5' }) => (
  <span className={`block ${h} ${w} animate-pulse rounded-chip bg-charcoal/[0.07]`} />
);

/** A card's placeholder body — rows of the shape the real body will have, so the card barely has to
 *  travel when the data lands and only its CONTENT crossfades. Its padding mirrors the real list's.
 *
 *  The rows carry `.card-item` so they ride the page's NESTED wave exactly as real rows do: the
 *  skeleton state has to animate like the loaded state, or the screen changes its language halfway
 *  through a load. */
const BodySkeleton: React.FC<{ rows: number }> = ({ rows }) => (
  <div className="flex flex-col gap-6 py-5" aria-hidden>
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="card-item flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Bar w="w-40" />
          <Bar w="w-24" h="h-2.5" />
        </div>
        <Bar w="w-16" h="h-8" />
      </div>
    ))}
  </div>
);

/** One section of the screen: either a group of scalar settings or one manageable catalog. */
type PreferenceSection =
  | { kind: 'settings'; group: string; skeletonRows: number }
  | {
      kind: 'catalog';
      catalog: CatalogKey;
      field: keyof PreferenceCatalogs;
      minimumActive: number;
      skeletonRows: number;
    };

/**
 * Which sections live under which tab, declared once.
 *
 * Grouping (rather than one long column) is the point: eight cards on one page meant eight
 * simultaneous height morphs and a reveal cascade long enough to read as lag, and an admin looking for
 * a delivery zone had to scroll past the evidence settings to find it. Each tab now holds two to four
 * related cards. The DATA is still one request, so switching tabs costs nothing but the animation.
 *
 * Mirrors the backend registry: adding a catalog there is one entry here plus two i18n strings.
 */
const TAB_SECTIONS: Record<PreferenceTab, readonly PreferenceSection[]> = {
  operation: [
    { kind: 'settings', group: 'orders', skeletonRows: 2 },
    { kind: 'settings', group: 'evidence', skeletonRows: 2 },
    // One field: how much warning a connected calendar gives. The CONNECTION itself is in Ajustes
    // (it is somebody's own Google account); the rule is here, where rules live.
    { kind: 'settings', group: 'calendar', skeletonRows: 1 },
    // One switch per create form — two rows, so the placeholder is the shape of what arrives.
    { kind: 'settings', group: 'forms', skeletonRows: 2 },
  ],
  orders: [
    { kind: 'catalog', catalog: 'event-types', field: 'eventTypes', minimumActive: 1, skeletonRows: 3 },
    { kind: 'catalog', catalog: 'zones', field: 'zones', minimumActive: 0, skeletonRows: 3 },
    { kind: 'catalog', catalog: 'payment-methods', field: 'paymentMethods', minimumActive: 0, skeletonRows: 2 },
    { kind: 'catalog', catalog: 'contact-types', field: 'contactTypes', minimumActive: 1, skeletonRows: 3 },
  ],
  products: [
    { kind: 'catalog', catalog: 'product-categories', field: 'productCategories', minimumActive: 1, skeletonRows: 3 },
    { kind: 'catalog', catalog: 'product-detail-types', field: 'productDetailTypes', minimumActive: 0, skeletonRows: 2 },
  ],
  // Three settings cards, not one, because they are three different things — the letterhead, what
  // the page declares about the deal, and the terms the document never prints (see the API
  // registry). `skeletonRows` is the count of fields in each, so the placeholder is the SHAPE of
  // what lands and the card barely travels when it does.
  documents: [
    { kind: 'settings', group: 'documents', skeletonRows: 2 },
    { kind: 'settings', group: 'documentConditions', skeletonRows: 3 },
    { kind: 'settings', group: 'legal', skeletonRows: 1 },
    { kind: 'catalog', catalog: 'bank-accounts', field: 'bankAccounts', minimumActive: 0, skeletonRows: 2 },
  ],
};

/** A section's title/description i18n leaf — settings groups and catalogs live under different maps. */
const sectionCopyKey = (section: PreferenceSection): string =>
  section.kind === 'settings' ? `groups.${section.group}` : `catalogs.${section.field}`;

/** What cascades INSIDE a section on this screen: a catalog's rows and a settings group's fields
 *  (skeleton placeholders carry `.card-item` too, so a shimmering card waves exactly like a real one). */
const SECTION_ITEMS = '.preference-row, .card-item';

/**
 * The group swap. The three groups live on a LEFT/RIGHT axis — they are a segmented control, same as
 * Agenda/Historial — so the motion is LATERAL and DIRECTIONAL, mirroring the pill: moving right, the
 * old group sweeps out to the left and the new one enters from the right; moving back it mirrors. A
 * vertical rise here would contradict the control the user just clicked.
 *
 * The entrance is the NESTED wave (`staggerInNested`): each section card arrives, and its rows fill in
 * just behind it. The exit stays one level — an exit is 0.2s, and staggering it twice only delays the
 * thing the user asked for.
 *
 * The initial mount renders its target directly (the page entrance owns that motion), and reduced
 * motion resolves instantly inside the helpers.
 */
function useTabSwap(
  target: PreferenceTab,
  root: React.RefObject<HTMLDivElement | null>,
): PreferenceTab {
  const [rendered, setRendered] = useState(target);
  const isInitial = useRef(true);
  /** Which side the next entrance comes FROM — set by the exit that preceded it. */
  const enterFrom = useRef<'left' | 'right'>('right');

  useEffect(() => {
    if (target === rendered) return;
    const forward = PREFERENCE_TABS.indexOf(target) > PREFERENCE_TABS.indexOf(rendered);
    let cancelled = false;
    void staggerOut(root.current, '.reveal-block', { to: forward ? 'left' : 'right' }).then(() => {
      if (cancelled) return;
      enterFrom.current = forward ? 'right' : 'left';
      setRendered(target);
    });
    return () => {
      cancelled = true;
    };
  }, [target, rendered, root]);

  useLayoutEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    staggerInNested(root.current, '.reveal-block', SECTION_ITEMS, { from: enterFrom.current });
  }, [rendered, root]);

  return rendered;
}

/**
 * The system preferences screen (`/panel/preferencias`) — **Admin only**: the route's `beforeLoad`
 * bounces every other role to their own panel home before this renders, the sidebar tab is hidden for
 * them, and every `/preferences` endpoint is Admin-gated server-side (the real boundary).
 *
 * It is deliberately SEPARATE from Ajustes: that screen is personal (password, 2FA), this one changes
 * how the business behaves for everyone. Mixing them would put "my account" and "the company's rules"
 * under one heading.
 *
 * **What appears here is what the system honours.** The scalar settings come from the API's own list,
 * which carries only the preferences code actually reads — a control that saves a value nothing reads
 * teaches the admin to distrust the screen. The catalogs are the six the backend registry declares
 * manageable; the lookups whose ids runtime code branches on (business types, rent units, roles,
 * currencies) are absent by design, not by omission.
 *
 * Motion is the panel doctrine throughout: the page registers its enter/exit pair over `.reveal-block`
 * sections, a tab change sweeps the old group out and the new one in, each card's body resolves through
 * `SectionReveal` (the card keeps its chrome and its height EASES to the content while the fields wave
 * in, cascading card by card), and inside a catalog card rows and editors grow rather than pop.
 */
const PreferencesPage: React.FC = () => {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError, isFetching, refetch } = usePreferences();
  // The open group is URL state, like the orders Agenda/Historial switch: a reload or a bookmark has
  // to come back to the group the admin was working in, not reset to the first one.
  const search = useSearch({ from: '/panel/preferencias' }) as PreferencesSearch;
  const navigate = useNavigate({ from: '/panel/preferencias' });
  const tab = activePreferenceTab(search);
  const renderedTab = useTabSwap(tab, panel);

  /** Commit a group change to the URL (same route — never through the panel transition). */
  const setTab = (next: PreferenceTab): void => {
    void navigate({ search: preferenceTabSearch(next), viewTransition: false });
  };

  const loading = isLoading && !data;
  const failed = isError && !data;

  // The panel transition owns arriving at and leaving the SCREEN, and this screen's axis is lateral
  // throughout — so its page entrance comes from the right and its exit heads left, the same way a
  // group swap moves. `fromCurrent` (resuming a cancelled exit) has no canonical side and is passed
  // through untouched.
  usePanelPageMotion(
    useMemo(
      () => ({
        enter: (options) =>
          options?.fromCurrent === true
            ? staggerIn(root.current, '.reveal-block', options)
            : staggerInNested(root.current, '.reveal-block', SECTION_ITEMS, { from: 'right' }),
        exit: () => staggerOut(root.current, '.reveal-block', { to: 'left' }),
      }),
      [],
    ),
  );

  // Mount entrance, and again when the error panel replaces the content. NOT keyed on `loading`:
  // skeleton → content is `SectionReveal`'s move, and replaying the page stagger there would blank
  // everything and re-run the whole entrance.
  useLayoutEffect(() => {
    staggerInNested(root.current, '.reveal-block', SECTION_ITEMS, { from: 'right' });
  }, [failed]);

  const municipalities: LookupRow[] = data?.municipalities ?? [];

  return (
    <div ref={root} className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8">
      <div className="reveal-block flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-bold text-charcoal sm:text-2xl">{t(`${KEY}.title`)}</h2>
          <p className="max-w-prose text-sm text-charcoal/55">{t(`${KEY}.lead`)}</p>
        </div>
        {!failed && <PreferenceTabs tab={tab} onChange={setTab} />}
      </div>

      {failed ? (
        <div className="reveal-block flex flex-1 flex-col">
          <ProductsStatus
            tone="error"
            title={t(`${KEY}.error.title`)}
            description={t(`${KEY}.error.description`)}
            action={
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                size="sm"
                loading={isFetching}
                startIcon={<HiOutlineArrowPath className="size-4" />}
                onClick={() => void refetch()}
              >
                {t(`${KEY}.error.retry`)}
              </Button>
            }
          />
        </div>
      ) : (
        <div
          ref={panel}
          id="preferences-tab-panel"
          role="tabpanel"
          aria-labelledby={`preferences-tab-${renderedTab}`}
          className="flex flex-col gap-8"
        >
          {loading && (
            <span role="status" aria-label={t(`${KEY}.loading`)} aria-busy className="sr-only" />
          )}

          {TAB_SECTIONS[renderedTab].map((section, index) => (
            <SettingsSection
              key={sectionCopyKey(section)}
              title={t(`${KEY}.${sectionCopyKey(section)}.title`)}
              description={t(`${KEY}.${sectionCopyKey(section)}.description`)}
            >
              <SectionReveal
                loading={loading}
                delaySeconds={index * SECTION_REVEAL_STEP}
                itemSelector={section.kind === 'settings' ? '.card-item' : '.preference-row'}
                // The skeleton→content resolve travels the same way as everything else here.
                from="right"
                skeleton={<BodySkeleton rows={section.skeletonRows} />}
              >
                {data &&
                  (section.kind === 'settings' ? (
                    <PreferenceSettingsCard settings={settingsInGroup(data.settings, section.group)} />
                  ) : (
                    <PreferenceCatalogCard
                      catalog={section.catalog}
                      rows={data.catalogs[section.field]}
                      municipalities={municipalities}
                      minimumActive={section.minimumActive}
                    />
                  ))}
              </SectionReveal>
            </SettingsSection>
          ))}
        </div>
      )}
    </div>
  );
};

export default PreferencesPage;

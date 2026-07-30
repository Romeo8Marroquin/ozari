import { useTranslation } from 'react-i18next';
import Button from '@components/Button';

const KEY = 'modules.panel.orders.create';
const EKEY = 'modules.panel.orders.edit';
const SECONDARY_COLOR = '#262626';
const SHIMMER = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/** The same card the form renders — so the reveal lands chrome on chrome. */
const Section: React.FC<{ title: string; description: string; rows: number }> = ({
  title,
  description,
  rows,
}) => (
  <section className="reveal-block min-w-0 rounded-card border border-charcoal/[0.07] bg-white px-5 py-5 shadow-sm sm:px-6">
    <h3 className="text-base font-semibold text-charcoal">{title}</h3>
    <p className="mb-5 mt-1 text-sm leading-relaxed text-charcoal/55">{description}</p>
    <div className="flex flex-col gap-5">
      {Array.from({ length: rows }).map((_, index) => (
        <span key={index} aria-hidden className={`block h-11 w-full ${SHIMMER}`} />
      ))}
    </div>
  </section>
);

/**
 * The edit page's cold-load stand-in — the ORDER FORM's real structure, not gray slabs: the five
 * section cards with their actual titles and descriptions, and the footer with its real (disabled)
 * buttons. Only the value-dependent bodies shimmer, because only they depend on the order that is
 * still loading.
 *
 * That is what lets `SectionReveal` dissolve it IN PLACE: chrome lands on chrome and the wave simply
 * swaps shimmer for fields, instead of one screen replacing another. Same doctrine (and nearly the
 * same file) as `ProductFormSkeleton`.
 */
const OrderFormSkeleton: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <Section
        title={t(`${KEY}.sections.client.title`)}
        description={t(`${KEY}.sections.client.description`)}
        rows={1}
      />
      <Section
        title={t(`${KEY}.sections.event.title`)}
        description={t(`${KEY}.sections.event.description`)}
        rows={2}
      />
      <Section
        title={t(`${KEY}.sections.lines.title`)}
        description={t(`${KEY}.sections.lines.description`)}
        rows={2}
      />
      <Section
        title={t(`${KEY}.sections.delivery.title`)}
        description={t(`${KEY}.sections.delivery.description`)}
        rows={3}
      />
      <Section
        title={t(`${KEY}.sections.money.title`)}
        description={t(`${KEY}.sections.money.description`)}
        rows={2}
      />
      <div className="reveal-block flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="soft" color={SECONDARY_COLOR} fullWidth disabled className="sm:w-auto">
          {t(`${KEY}.actions.cancel`)}
        </Button>
        <Button color={SECONDARY_COLOR} fullWidth disabled className="sm:w-auto">
          {t(`${EKEY}.actions.submit`)}
        </Button>
      </div>
    </div>
  );
};

export default OrderFormSkeleton;

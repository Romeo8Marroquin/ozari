import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import {
  DetailsSkeleton,
  FormSection,
  InfoSkeleton,
  PhotosSkeleton,
  PricingSkeleton,
} from './ProductFormChrome';

const KEY = 'modules.panel.products.create';
const EDIT_KEY = 'modules.panel.products.edit';
const SECONDARY_COLOR = '#262626';

/**
 * The edit page's cold-load stand-in — the form's REAL structure, not gray slabs: everything known
 * at build time renders for real (the four section cards with their actual titles/descriptions,
 * the footer with its real — disabled — buttons), and ONLY the value-dependent bodies shimmer
 * (what the fields hold, how many photos/details there are). The add-product loading doctrine at
 * page scale, so the reveal into the live form barely has to morph: chrome lands on chrome, and
 * the wave swaps shimmer for fields.
 */
const ProductFormSkeleton: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <FormSection
        title={t(`${KEY}.sections.info.title`)}
        description={t(`${KEY}.sections.info.description`)}
      >
        <InfoSkeleton />
      </FormSection>
      <FormSection
        title={t(`${KEY}.sections.photos.title`)}
        description={t(`${EDIT_KEY}.photosDescription`)}
      >
        <PhotosSkeleton />
      </FormSection>
      <FormSection
        title={t(`${KEY}.sections.pricing.title`)}
        description={t(`${KEY}.sections.pricing.description`)}
      >
        <PricingSkeleton />
      </FormSection>
      <FormSection
        title={t(`${KEY}.sections.details.title`)}
        description={t(`${KEY}.sections.details.description`)}
      >
        <DetailsSkeleton />
      </FormSection>
      <div className="reveal-block flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="soft" color={SECONDARY_COLOR} fullWidth disabled className="sm:w-auto">
          {t(`${KEY}.actions.cancel`)}
        </Button>
        <Button color={SECONDARY_COLOR} fullWidth disabled className="sm:w-auto">
          {t(`${EDIT_KEY}.actions.submit`)}
        </Button>
      </div>
    </div>
  );
};

export default ProductFormSkeleton;

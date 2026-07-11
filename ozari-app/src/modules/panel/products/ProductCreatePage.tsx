import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowLeft } from 'react-icons/hi2';
import Button from '@components/Button';
import RoleGate from '@components/RoleGate';
import { Role } from '@constants/Roles';
import { staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import ProductForm from './ProductForm';
import ProductsStatus from './ProductsStatus';

const KEY = 'modules.panel.products.create';

// The panel chrome keeps the "Productos" title (this is a nested products page); the page carries
// its own heading + back affordance. Same shared motion contract as every panel page: sections are
// `.reveal-block`s, the entrance plays on mount, and the registered pair lets the layout exit/resume.
const ProductCreatePage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    staggerIn(root.current, '.reveal-block');
  }, []);

  usePanelPageMotion(
    useMemo(
      () => ({
        enter: (options) => staggerIn(root.current, '.reveal-block', options),
        exit: () => staggerOut(root.current, '.reveal-block'),
      }),
      [],
    ),
  );

  return (
    <div ref={root} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      {/* Role is a UX layer only — the backend 403 is the real guard. A non-admin deep-linking here
          gets a friendly panel, never a crash or a bare redirect. */}
      <RoleGate
        roles={[Role.Admin]}
        fallback={
          <div className="reveal-block flex flex-1 flex-col">
            <ProductsStatus
              tone="empty"
              title={t(`${KEY}.noAccess.title`)}
              description={t(`${KEY}.noAccess.description`)}
              action={
                <Button
                  variant="soft"
                  color="#262626"
                  size="sm"
                  startIcon={<HiOutlineArrowLeft className="size-4" />}
                  onClick={() => panelNavigate('/panel/productos')}
                >
                  {t(`${KEY}.noAccess.back`)}
                </Button>
              }
            />
          </div>
        }
      >
        <div className="reveal-block flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => panelNavigate('/panel/productos')}
            className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-charcoal/55 transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 rounded-chip"
          >
            <HiOutlineArrowLeft aria-hidden className="size-4" />
            {t(`${KEY}.back`)}
          </button>
          <h2 className="text-xl font-bold text-charcoal sm:text-2xl">{t(`${KEY}.title`)}</h2>
          <p className="text-sm text-charcoal/55">{t(`${KEY}.lead`)}</p>
        </div>

        <ProductForm />
      </RoleGate>
    </div>
  );
};

export default ProductCreatePage;

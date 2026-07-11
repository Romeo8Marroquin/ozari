import { useTranslation } from 'react-i18next';
import LogoMark from '@components/LogoMark';
import { formatProductPrice, primaryImageUrl } from './productPresentation';
import type { Product } from './product.types';

const KEY = 'modules.panel.products';

/**
 * The stock indicator — driven entirely by **which role-gated fields are present** (the projection
 * contract), so there's no role check here:
 *  - `quantity` present (Admin) → the exact count, or "Agotado" at zero;
 *  - else `inStock` present (Employee) → a plain available / out signal;
 *  - else (Client) → nothing (clients never see stock — deliberate for a rentals catalog).
 */
const StockBadge: React.FC<{ product: Product }> = ({ product }) => {
  const { t } = useTranslation();
  const { quantity, inStock } = product;

  let available: boolean;
  let label: string;
  if (quantity !== undefined) {
    available = quantity > 0;
    label = available ? t(`${KEY}.stock.count`, { count: quantity }) : t(`${KEY}.stock.out`);
  } else if (inStock !== undefined) {
    available = inStock;
    label = inStock ? t(`${KEY}.stock.available`) : t(`${KEY}.stock.out`);
  } else {
    return null;
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-chip px-2 py-0.5 text-[11px] font-semibold ${
        available ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
      }`}
    >
      {label}
    </span>
  );
};

/**
 * A single catalog tile: a portrait 4:3 hero (the product photo, or the brand mark when it has none),
 * the business-type chip over it, then the category, name, headline price, and a role-aware stock
 * badge. Presentational only — it renders exactly the fields the backend chose to send for the current
 * role, so the same component serves Client, Employee, and Admin without branching on the role itself.
 */
const ProductCard: React.FC<{ product: Product }> = ({ product }) => {
  const { t } = useTranslation();
  const imageUrl = primaryImageUrl(product);
  const price = formatProductPrice(product);

  return (
    <article className="group flex flex-col overflow-hidden rounded-card bg-white ring-1 ring-black/[0.04] shadow-sm transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-br from-cream to-blossom">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={t(`${KEY}.imageAlt`, { name: product.name })}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <span className="grid size-full place-items-center text-charcoal/25">
            <LogoMark className="size-14" />
          </span>
        )}
        <span className="absolute left-2 top-2 rounded-chip bg-white/85 px-2 py-0.5 text-[11px] font-medium text-charcoal/70 shadow-sm backdrop-blur">
          {product.businessType}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <span className="text-xs font-medium uppercase tracking-wide text-charcoal/45">
          {product.category}
        </span>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-charcoal">{product.name}</h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
          {price ? (
            <span className="text-sm font-bold text-charcoal">{price}</span>
          ) : (
            <span aria-hidden />
          )}
          <StockBadge product={product} />
        </div>
      </div>
    </article>
  );
};

export default ProductCard;

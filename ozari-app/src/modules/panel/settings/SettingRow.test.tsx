import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingRow from './SettingRow';

/**
 * These assert CLASSES, which is unusual here and deliberate: the bug this row keeps having is a
 * layout bug, it is invisible to every other kind of test (jsdom has no layout), and it has now
 * come back three times in three different disguises — `shrink-0`, `min-w-0`, and a `sm:` viewport
 * breakpoint. What follows pins the two decisions that keep it from coming back a fourth time.
 */
describe('SettingRow', () => {
  const rowOf = (children: React.ReactNode): HTMLElement => {
    const { container } = render(
      <SettingRow label="Contraseña" description="Cámbiala cuando quieras.">
        {children}
      </SettingRow>,
    );
    return container.firstElementChild as HTMLElement;
  };

  it('renders the label, the description and the control', () => {
    rowOf(<button type="button">Cambiar</button>);
    expect(screen.getByText('Contraseña')).toBeInTheDocument();
    expect(screen.getByText('Cámbiala cuando quieras.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeInTheDocument();
  });

  it('folds by its OWN width — it wraps, and never asks the viewport', () => {
    const row = rowOf(<button type="button">Cambiar</button>);
    // Wrapping is the whole mechanism: when the description's floor and the controls no longer fit
    // together, the controls fold onto their own line instead of squeezing the description.
    expect(row.className).toContain('flex-wrap');
    // A viewport breakpoint is what broke this row at 793px — a wide WINDOW whose card was ~260px.
    expect(row.className).not.toMatch(/\b(sm|md|lg|xl):/);
  });

  it('gives the description a floor and the leftover space, and the controls neither', () => {
    const row = rowOf(<button type="button">Cambiar</button>);
    const [text, actions] = Array.from(row.children) as HTMLElement[];
    // `grow` pins the controls to the right edge without a `justify-*`; `basis-56` is the width
    // below which the row folds rather than shredding the sentence.
    expect(text.className).toContain('grow');
    expect(text.className).toContain('basis-56');
    // Both of these have been tried on the action side and both break it: `shrink-0` overflows the
    // card, `min-w-0` lets the group size below its own buttons and paint over the description.
    expect(actions.className).not.toContain('shrink-0');
    expect(actions.className).not.toMatch(/\bmin-w-0\b/);
    // It still has to wrap internally, so a group too wide for a phone card breaks between its own
    // buttons rather than out of the card.
    expect(actions.className).toContain('flex-wrap');
  });

  it('keeps the morph layer and the flip identity for the cards that ask for them', () => {
    const { container } = render(
      <SettingRow
        flipId="google"
        className="calendar-flip"
        morphDescription
        label="Google Calendar"
        description="Conectado como a@b.com"
      >
        <button type="button">Desconectar</button>
      </SettingRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.dataset.flipId).toBe('google');
    expect(row.className).toContain('calendar-flip');
    expect(screen.getByText('Conectado como a@b.com')).toBeInTheDocument();
  });
});

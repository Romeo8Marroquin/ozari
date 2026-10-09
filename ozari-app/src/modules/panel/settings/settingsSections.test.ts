import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { bringIntoPanelView } = vi.hoisted(() => ({ bringIntoPanelView: vi.fn() }));
vi.mock('../pageMotion', () => ({ bringIntoPanelView }));

import { openSettingsSection, revealPendingSettingsSection } from './settingsSections';

/** An Ajustes section as `SettingsSection` renders one with an `anchor`. */
const mountSection = (anchor: string): HTMLElement => {
  const section = document.createElement('div');
  section.dataset.settingsSection = anchor;
  section.tabIndex = -1;
  document.body.appendChild(section);
  return section;
};

let now = 1_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  // Focus is deferred a frame (see below); run frames at once so it is observable.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  // Never leak a request from one test into the next.
  revealPendingSettingsSection();
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('openSettingsSection', () => {
  it('reveals the section IN PLACE, smoothly, when Ajustes is already on screen', () => {
    // A plain navigation to the page you are on does nothing — the bug "Seguridad" had there.
    const section = mountSection('security');
    const navigate = vi.fn();
    openSettingsSection('security', navigate);

    // Still routed through the panel navigation: mid-exit FROM Ajustes, that is what cancels the
    // exit and settles the page back so there is something to reveal.
    expect(navigate).toHaveBeenCalledWith('/panel/ajustes');
    expect(bringIntoPanelView).toHaveBeenCalledWith(section, { smooth: true });
    // And the user arrives WITH focus, not stranded on the menu that sent them.
    expect(document.activeElement).toBe(section);

    // Nothing is left pending for a later visit to stumble on.
    revealPendingSettingsSection();
    expect(bringIntoPanelView).toHaveBeenCalledTimes(1);
  });

  it('from another page, navigates — and the page claims the section as it mounts, instantly', () => {
    const navigate = vi.fn();
    openSettingsSection('account', navigate);
    expect(navigate).toHaveBeenCalledWith('/panel/ajustes');
    expect(bringIntoPanelView).not.toHaveBeenCalled();

    // Ajustes mounts.
    now += 600;
    const section = mountSection('account');
    revealPendingSettingsSection();
    // A jump, not a glide: it happens before the entrance plays, so it is never seen.
    expect(bringIntoPanelView).toHaveBeenCalledWith(section, { smooth: false });
    expect(document.activeElement).toBe(section);
  });

  it('waits for the entrance to SHOW the section before focusing it', () => {
    // Ajustes fades its blocks in from `visibility: hidden`, and a hidden element refuses focus —
    // a focus on the first frame was silently dropped, leaving the user on the menu button.
    openSettingsSection('security', vi.fn());
    const section = mountSection('security');
    section.style.visibility = 'hidden';
    let frames = 0;
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      frames += 1;
      if (frames === 3) section.style.visibility = 'visible';
      callback(0);
      return 0;
    });
    revealPendingSettingsSection();
    expect(document.activeElement).toBe(section);
    expect(frames).toBe(3);
  });

  it('stops waiting after about a second if the section never shows', () => {
    // A bounded wait, never a loop that outlives the page. (jsdom, unlike a browser, lets a hidden
    // element take focus — so what is pinned here is the bound itself: 60 waits, then one try.)
    openSettingsSection('security', vi.fn());
    const section = mountSection('security');
    section.style.visibility = 'hidden';
    revealPendingSettingsSection();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(61);
  });

  it('claims a request only ONCE', () => {
    openSettingsSection('security', vi.fn());
    mountSection('security');
    revealPendingSettingsSection();
    revealPendingSettingsSection();
    expect(bringIntoPanelView).toHaveBeenCalledTimes(1);
  });

  it('lets a request go stale — a cancelled trip must not jump the page much later', () => {
    // Re-clicking the tab you were leaving cancels the navigation, and the request would otherwise
    // sit there until the next, unrelated visit to Ajustes from the sidebar.
    openSettingsSection('security', vi.fn());
    now += 10_000;
    mountSection('security');
    revealPendingSettingsSection();
    expect(bringIntoPanelView).not.toHaveBeenCalled();
  });

  it('does nothing on a mount with no request, or for a section that is not rendered', () => {
    revealPendingSettingsSection();
    openSettingsSection('security', vi.fn());
    revealPendingSettingsSection(); // the page mounted without that section
    expect(bringIntoPanelView).not.toHaveBeenCalled();
  });
});

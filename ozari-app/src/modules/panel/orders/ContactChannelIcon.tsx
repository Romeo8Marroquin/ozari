import { useLayoutEffect, useRef, useState } from 'react';
import { FaWhatsapp } from 'react-icons/fa6';
import { HiOutlineEnvelope, HiOutlinePhone, HiOutlineUser } from 'react-icons/hi2';
import { type ContactChannelKind } from '@constants/Regex';
import { iconSwapBlink } from '../pageMotion';

/** The leading icon per contact channel (OTHER / no-selection = a generic person, so the field's
 *  left padding never jumps between "no icon" and "icon"). */
const CHANNEL_ICONS: Record<ContactChannelKind, React.ReactNode> = {
  whatsapp: <FaWhatsapp />,
  phone: <HiOutlinePhone />,
  email: <HiOutlineEnvelope />,
  other: <HiOutlineUser />,
};

/**
 * A contact field's leading icon, swapped with a soft vertical "blink" (the password-eye motion)
 * whenever the channel changes — inheriting the field's colour (error/focus) from `CustomInput`'s
 * icon button via `currentColor`. Shared by the registry modal and the order form's delivery
 * contact. Reduced-motion swaps instantly (handled inside `iconSwapBlink`).
 */
const ContactChannelIcon: React.FC<{ kind: ContactChannelKind }> = ({ kind }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(kind);
  const [shown, setShown] = useState(kind);
  useLayoutEffect(() => {
    if (prev.current === kind) return;
    prev.current = kind;
    iconSwapBlink(ref.current, () => setShown(kind));
  }, [kind]);
  return (
    <span ref={ref} aria-hidden className="grid size-full place-items-center">
      {CHANNEL_ICONS[shown]}
    </span>
  );
};

export default ContactChannelIcon;

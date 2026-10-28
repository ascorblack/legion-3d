/**
 * The street compass (top centre: С / В / Ю / З and building markers) only makes sense on the street. It is hidden in
 * the 3D expedition view (its own top banner sits in the same place) and inside rooms (the mine, shops), where the
 * markers point at buildings of a street you are not on.
 */
import { coreFeature } from './types';

export default coreFeature({
  id: 'compassVis',
  order: 210,
  setup(ctx) {
    let exp = false;
    const host = document.querySelector('.l3d-ui') as HTMLElement | null;
    const comp = () => (host?.shadowRoot?.querySelector('.compass') as HTMLElement | null) ?? null;
    const apply = () => { const c = comp(); if (c) c.style.visibility = exp || ctx.rooms.current ? 'hidden' : ''; };
    const onExp = (e: Event) => { exp = !!(e as CustomEvent).detail?.active; apply(); };
    window.addEventListener('l3d:expedition', onExp);
    const offRooms = ctx.rooms.onChange(apply);
    apply();
    return () => { window.removeEventListener('l3d:expedition', onExp); offRooms(); exp = false; apply(); };
  },
});

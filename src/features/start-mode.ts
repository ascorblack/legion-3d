/**
 * «При входе открывать»: what the channel page shows when it loads — the classic 2D site (default), 3D, or the mode used
 * last time. Read by src/content/main.ts at page start (localStorage 'l3d.start'); the row only edits it.
 */
import { coreFeature } from './types';
import { registerSettingRow } from '../ui/settings-ext';

export const START_KEY = 'l3d.start';

export default coreFeature({
  id: 'startMode',
  order: 230,
  setup() {
    return registerSettingRow({
      key: START_KEY, label: 'При входе открывать', group: 'Прочее', order: 5, kind: 'seg',
      sub: 'что показывать, когда открываешь страницу канала; переключиться всегда можно кнопкой «3D» или F8',
      options: [['2d', 'Обычный сайт'], ['3d', '3D'], ['last', 'Как в прошлый раз']], def: '2d',
    });
  },
});

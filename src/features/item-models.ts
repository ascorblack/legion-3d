/** 3D item models (shop shelves, loot, showcase): registered from src/avatar/items.ts. */
import type { Feature } from '../contracts/ext';
import { registerItemModels } from '../avatar/items';

const itemModels: Feature = { id: 'item-models', order: 5, setup: (ctx) => registerItemModels(ctx.registries.itemModels, () => String(ctx.layout()?.styleId || '')) };
export default itemModels;

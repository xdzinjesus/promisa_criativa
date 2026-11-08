import { PLANS, buildPlanPrompts } from './plan-prompts.js';
import { DELIVERY_PLANS, deliveryGroups, deliveryItems, deliveryProgress } from './delivery-checklist.js';
// O painel não importa módulos: recebe os prompts por esta variável global.
window.promisaPlanPrompts = { PLANS, buildPlanPrompts };
window.promisaDelivery = { DELIVERY_PLANS, deliveryGroups, deliveryItems, deliveryProgress };

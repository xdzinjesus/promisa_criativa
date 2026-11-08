import { PLANS, buildPlanPrompts } from './plan-prompts.js';
// O painel não importa módulos: recebe os prompts por esta variável global.
window.promisaPlanPrompts = { PLANS, buildPlanPrompts };

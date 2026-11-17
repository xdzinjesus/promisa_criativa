// Entrega a regra da agenda (src/agenda.js) para o painel (script comum, sem módulos).
import * as agenda from './agenda.js';
if (typeof window !== 'undefined') window.promisaAgenda = agenda;

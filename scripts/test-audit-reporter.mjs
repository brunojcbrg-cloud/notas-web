import { readdirSync } from 'node:fs';
import { join } from 'node:path';

function contarTestes(diretorio) {
  return readdirSync(diretorio, { withFileTypes: true }).reduce((total, entrada) => {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) return total + contarTestes(caminho);
    return total + (entrada.name.endsWith('.test.ts') ? 1 : 0);
  }, 0);
}

export default class TestAuditReporter {
  onInit(vitest) {
    this.raiz = vitest.config.root;
  }

  onTestRunEnd(modulos, erros) {
    const emDisco = contarTestes(join(this.raiz, 'tests'));
    const carregados = modulos.length;
    console.log(`\n Test Files ${carregados} loaded (${emDisco} on disk)`);
    console.log(` Errors     ${erros.length} errors`);
    if (carregados !== emDisco || erros.length !== 0) process.exitCode = 1;
  }
}

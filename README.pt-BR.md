# skail catalog import (Node.js)

[English](README.md)

Um app com uma function do skail que importa um catálogo de produtos de uma API pública, 20 produtos por página, e espera 2 segundos entre as páginas, o limite de requisições da origem. Cada página é um command: quando uma página falha, o skail tenta de novo só aquela página, e quando o app para no meio, o import continua na página onde parou, sem ler de novo as páginas já importadas. A demo importa os 194 produtos da [DummyJSON](https://dummyjson.com) em 10 páginas. Você inicia o import numa página que o app serve em http://localhost:8080.

Ele mostra três recursos do skail:

- **durabilidade**: feche o app no meio de um import, abra de novo e o import continua na página onde parou;
- **novas tentativas automáticas**: uma página que o catálogo de destino rejeita é tentada de novo sozinha, e gravá-la de novo substitui a anterior, então nada se duplica;
- um **delay durável** entre as páginas, que não segura thread nem processo.

## Requisitos

- Um destes: [Docker](https://docs.docker.com/get-docker/), [Podman](https://podman.io/docs/installation) ou o [Node.js](https://nodejs.org) 20.12 ou mais novo. O script de execução usa o primeiro que encontrar.
- Um environment do skail com um workload registrado para o `SKAIL_WORKLOAD` do `.env` (`catalogimport:v1.0.0` por padrão). O [Quickstart](https://docs.skail.dev/comece-aqui/quickstart) mostra como criar a conta, o environment e o workload.

O projeto usa o `@skail/runtime` e o `@skail/build` **2.0.1-rc4**.

## Rodar

```bash
cp .env.example .env  # preencha SKAIL_SIDECAR, SKAIL_NAMESPACE e SKAIL_KEY (portal > Environments & keys > Connect)
scripts/run.sh        # depois abra http://localhost:8080
```

No Windows, no PowerShell: `copy .env.example .env` e depois `powershell -ExecutionPolicy Bypass -File scripts\run.ps1`. O script funciona no Windows PowerShell que já vem no Windows; não precisa do PowerShell 7.

O script roda a demo com o que a máquina tiver: Docker, depois Podman, depois o Node.js. Se não achar nenhum, ele diz o que instalar. Sem o script, os comandos são `npm install`, `npm run build` e `npm start`.

![A página da demo](docs/page.png)

Cada página aparece na tabela conforme é gravada no catálogo de destino, com o número de produtos, as tentativas e os primeiros produtos. A página se atualiza sozinha a cada segundo, e cada passo também aparece no console.

## Os caminhos

| O que você clica | O que acontece | Resultado |
|---|---|---|
| **Import catalog** | 10 páginas, nove de 20 produtos e a última de 14, com 2 segundos entre elas | **completed**, 194 produtos em 10 páginas |
| marque **Make the target catalog reject page 3 twice** e depois **Import catalog** | o destino rejeita as duas primeiras gravações da página 3; o skail tenta de novo só aquela página, cerca de 15 e 30 segundos depois, e o import segue | **completed**, com 3 tentativas na página 3 |

O botão volta a funcionar quando o import termina: um import por vez.

## Como funciona

O app faz três coisas no mesmo processo: serve a página, hospeda o worker que executa a function (`createSkailPlatform`, com o bundle gerado pelo `npm run build`) e inicia cada import pela API HTTP do skail. O catálogo de destino é simulado na memória do app. Os commands rodam numa VM isolada, então chegam ao catálogo de destino por HTTP, na própria porta do app em `/internal/`, como chegariam à API de um catálogo real.

```http
POST {SKAIL_SIDECAR}/api/v1/trigger/catalogimport/v1.0.0/ImportCatalog/{importId}
["{importId}"]
```

A function e o command da página, em [`src/catalog-functions.ts`](src/catalog-functions.ts):

```ts
@SkailFunction()
async ImportCatalog(importId: string): Promise<ImportResult> {
  let page = 1;
  let products = 0;
  while (true) {
    const result = await this.ImportPage(importId, page);
    products += result.imported;
    if (!result.hasMore || result.imported === 0 || page === CatalogLimits.maxPages) break;

    page++;
    await Skail.delaySeconds(CatalogLimits.secondsBetweenPages);
  }

  const result = { importId, pages: page, products };
  await this.ReportResult(result);
  return result;
}

@SkailCommand({ retryCount: 3 })
async ImportPage(importId: string, page: number): Promise<ImportedPage> {
  const read = await getSourcePage(page);
  await callApp("target", { importId, page, products: read.products });
  return { imported: read.products.length, hasMore: read.hasMore };
}
```

- `page` e `products` vêm só dos resultados do `ImportPage`. Na retomada, o skail roda a function de novo sobre o histórico da execução: as páginas já importadas devolvem o resultado registrado sem ler a origem, e o laço segue na próxima página.
- O `ImportPage` lê e grava no mesmo command. Uma nova tentativa roda as duas coisas de novo (`@SkailCommand({ retryCount: 3 })`): a leitura não muda nada, e o destino substitui uma página gravada duas vezes (o id do import e o número da página são a chave), então nada se duplica.
- Os produtos nunca saem do command: o resultado tem só o número de produtos e se há mais páginas, então o histórico da execução fica pequeno.
- O laço para quando a origem diz que não há mais, quando uma página vem vazia ou na página 50, um limite que mantém o histórico da execução contido se a origem nunca avisar o fim.

| Arquivo | O que tem |
|---|---|
| `src/catalog-functions.ts` | A function e os commands dela. |
| `src/source.ts` | A chamada à DummyJSON. |
| `src/model.ts` | Os limites, os produtos e o resultado do import. |
| `src/import-desk.ts` | Inicia os imports da página e faz o papel do catálogo de destino. |
| `page/index.html` | A página, com a marca do skail. |
| `src/skail-api.ts` | O trigger pela API HTTP do skail. |
| `src/main.ts` | Lê o `.env`, serve a página, a API dela e o catálogo de destino, e inicia o worker. |
| `scripts/build-skail.mjs` | Gera o bundle em `.skail/` para o `SKAIL_WORKLOAD`; rode `npm run build` de novo se ele mudar. |
| `scripts/run.sh`, `scripts/run.ps1`, `Dockerfile` | Rodam a demo com Docker, Podman ou o Node.js, o que houver na máquina. |

## Veja a durabilidade

1. Rode `scripts/run.sh`, abra a página e clique em **Import catalog**.
2. Depois de algumas páginas, aperte **Ctrl+C**. O app fecha; o import continua no skail.
3. Rode `scripts/run.sh` de novo e abra a página. O skail entrega o import ao app: ele continua na página onde parou, sem ler de novo as páginas já importadas, e termina com 194 produtos. A tabela mostra as páginas gravadas depois do reinício; as de antes estavam na memória do app que fechou. Uma página que estava no meio do command quando o app fechou pode levar alguns minutos para ser entregue de novo; o import espera por ela.

No portal, abra o [Monitor](https://docs.skail.dev/referencia/portal/monitor) do seu environment e clique no import: ele lista um `ImportPage` por página, com o `Delay` entre elas, e o `ReportResult` final. Com a caixa marcada, a página 3 mostra as duas tentativas com falha.

## Observações

- Apps rodando o mesmo `SKAIL_WORKLOAD` no mesmo environment dividem as mesmas execuções: use um workload (ou environment) por pessoa.

## Aviso

**Esta é uma demonstração, não é código de produção.** Ela existe só para mostrar como o [skail](https://docs.skail.dev) funciona e é fornecida "como está", sem garantia de nenhum tipo. Ela lê uma API gratuita de terceiros (a DummyJSON), que pode mudar, limitar ou recusar requisições a qualquer momento, e o catálogo de destino é simulado.

## Licença

[Apache-2.0](LICENSE)

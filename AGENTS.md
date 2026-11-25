# Arquitetura

- `index.html` e `src/home.js` são o catálogo, a galeria e o agendamento. `admin.html` e `src/admin.js` são o painel protegido pelo papel `admin` do Netlify Identity. `src/style.css` contém o estilo compartilhado.
- `src/catalog.js` é a fonte única de serviços e valores, em centavos. Use sempre esse catálogo no servidor; o navegador não define valores da cobrança.
- `netlify/server/index.mjs` atende `/api/*`. `netlify/server/schedule.mjs` define a grade fixa de 90 minutos no horário de Salvador. `netlify/server/pix.mjs` implementa a comunicação com o Mercado Pago e as transições de pagamento; `netlify/functions/reconciliar-pix.mts` é a conciliação agendada.
- `db/schema.ts` é a fonte de verdade do Postgres. Gere migrations com `npx drizzle-kit generate --name <nome>` após mudanças de esquema. O índice único parcial impede que duas reservas ativas ou um bloqueio e uma reserva compartilhem o mesmo horário.
- A cobrança usa a referência e a chave de idempotência da reserva. A confirmação depende da consulta autenticada ao provedor, nunca de dados enviados pelo navegador ou do corpo do webhook isoladamente. Não libere um horário só porque passou o vencimento local.
- Use ESM, textos da interface em português do Brasil e nós DOM com `textContent` ao exibir dados de usuários. Não coloque segredos ou dados de clientes em logs, arquivos públicos ou variáveis `VITE_`.
- As imagens ilustrativas em `public/img` são servidas pelo Netlify Image CDN. Não configure um rewrite global para o HTML: ele interceptaria `/api/*` antes do servidor.

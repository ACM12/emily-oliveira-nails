# Emily Oliveira Nail Designer

Site responsivo do estúdio de manicure e nail art. Inclui catálogo, galeria ilustrativa, contato pelo WhatsApp, agenda online com sinal de 50% por Pix e área administrativa em `/admin`.

## Desenvolvimento local

O front-end usa HTML, CSS e JavaScript com Vite. A API roda no Netlify Server; Netlify Database (Postgres) e Drizzle armazenam clientes, reservas e bloqueios. O painel usa Netlify Identity e o Pix usa a API de pagamentos do Mercado Pago.

Com Node.js 24 e Netlify CLI instalado, rode `npm ci`, vincule o projeto com `netlify link` e inicie `npm run dev`. O site usa a porta `8889`. Teste login e recuperação em um deploy com Identity, pois o serviço não é emulado localmente. As imagens usam Netlify Image CDN.

## Operação

- O calendário usa o horário de Salvador. Há sessões de 90 minutos a partir das 07h, sem ultrapassar o fechamento às 23h. O primeiro horário disponível deve estar a pelo menos 45 minutos, para permitir o pagamento, e a agenda abre até 60 dias à frente. Arte em 3D é cotada no WhatsApp; acessórios são adicionais.
- O envio da reserva cadastra o contato, bloqueia temporariamente o horário e solicita uma cobrança Pix. Após 35 minutos o código deixa de ser exibido; o horário só é liberado após a conciliação. A aprovação é verificada no Mercado Pago, por webhook ou conciliação, antes de confirmar a reserva. Os dados do cliente só aparecem no painel autenticado.
- O painel requer convite no Netlify Identity e função `admin` atribuída no cadastro do usuário. Open Manage and search for 'Identity'. O painel mostra atendimentos, clientes e bloqueios manuais. Pagamentos em revisão devem ser tratados com o cliente e no Mercado Pago.

## Integração do Pix

O servidor lê `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET` no ambiente de execução. Sem as duas variáveis, o site não emite cobranças e oferece a reserva pelo WhatsApp. Não use variáveis com prefixo `VITE_`, não coloque credenciais em arquivos versionados e não use credenciais de produção em previews.

No Mercado Pago, a configuração esperada é de **Webhooks de Pagamentos** para `/api/mercado-pago/webhook`, no domínio HTTPS do deploy, usando a assinatura secreta da mesma aplicação que emite as cobranças. A API define a URL na criação do Pix. Antes do lançamento, valide de ponta a ponta a geração do código, a aprovação, o vencimento e a liberação do horário com uma conta e um ambiente de teste.

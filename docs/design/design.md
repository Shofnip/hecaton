# Hecaton — Especificação de Design (v1.0)

Documento de referência do rework visual do Hecaton, baseado no protótipo aprovado (`helloweb-rework.jsx`). Descreve tokens visuais, layout, componentes, estados e comportamentos esperados na implementação real (Electron).

---

## 1. Visão geral

O Hecaton é um gerenciador de até **4 telas web independentes** ("Telas"), cada uma rodando uma aplicação web (padrão: Poke IdleWorld). O layout segue o conceito de _video wall_: grade densa com espaçamentos mínimos, controles por tela e uma barra lateral fina de ações globais.

Modos de visualização:

| Modo           | Descrição                                                                             |
| -------------- | ------------------------------------------------------------------------------------- |
| **Grade**      | Padrão. 1 tela = área inteira; 2 telas = metade cada; 3–4 telas = grade 2×2.          |
| **Foco**       | Uma tela ocupa a área principal; as demais viram miniaturas na parte inferior.        |
| **Tela cheia** | Uma tela cobre toda a aplicação (inclusive a barra lateral), como um player de vídeo. |

---

## 2. Tokens de tema

Dois temas, com o **escuro como padrão**. Ambos evitam extremos de contraste (sem branco puro, sem preto puro em superfícies de UI) para conforto visual em uso prolongado.

### 2.1 Tema escuro

| Token        | Valor                   | Uso                                                          |
| ------------ | ----------------------- | ------------------------------------------------------------ |
| `bg`         | `#15171b`               | Fundo da aplicação                                           |
| `sidebar`    | `#101216`               | Fundo da barra lateral                                       |
| `panel`      | `#1d2026`               | Cards, modais, popovers                                      |
| `panelSoft`  | `#23262d`               | Superfícies secundárias (barra de controles, itens de modal) |
| `border`     | `#2c3038`               | Bordas e divisores                                           |
| `text`       | `#e7e9ec`               | Texto principal                                              |
| `muted`      | `#9298a2`               | Texto secundário e ícones em repouso                         |
| `accent`     | `#4cc38a`               | Estado ligado, ações positivas, destaques                    |
| `accentSoft` | `rgba(76,195,138,0.14)` | Fundo de elementos ativos                                    |
| `warn`       | `#d9b13b`               | Estado "carregando"                                          |
| `danger`     | `#e5484d`               | Erros, ações destrutivas                                     |
| `dangerSoft` | `rgba(229,72,77,0.12)`  | Fundo de elementos de risco                                  |
| `screenOff`  | `#0b0c0f`               | Viewport das telas                                           |
| `screenHint` | `#4a515c`               | Texto/ícones dentro do viewport                              |
| `overlay`    | `rgba(0,0,0,0.6)`       | Fundo de modais                                              |
| `knob`       | `#ffffff`               | Bolinha dos toggles                                          |

### 2.2 Tema claro

Tons "papel" rebaixados — nenhuma superfície em branco puro, texto em cinza-escuro em vez de preto.

| Token        | Valor                                                |
| ------------ | ---------------------------------------------------- |
| `bg`         | `#e3e1db`                                            |
| `sidebar`    | `#d9d7d0`                                            |
| `panel`      | `#efeee9`                                            |
| `panelSoft`  | `#e7e5df`                                            |
| `border`     | `#cfccc4`                                            |
| `text`       | `#41444a`                                            |
| `muted`      | `#7d8188`                                            |
| `accent`     | `#2f8f63`                                            |
| `accentSoft` | `rgba(47,143,99,0.13)`                               |
| `warn`       | `#a8862c`                                            |
| `danger`     | `#bf4046`                                            |
| `dangerSoft` | `rgba(191,64,70,0.10)`                               |
| `screenOff`  | `#191b1f` (viewport permanece escuro nos dois temas) |
| `screenHint` | `#5b6470`                                            |
| `overlay`    | `rgba(52,54,58,0.38)`                                |
| `knob`       | `#fbfaf7`                                            |

### 2.3 Tipografia e forma

- Fonte: **Sora** (pesos 400 / 600 / 700), fallback `Segoe UI, system-ui, sans-serif`.
- Raio de borda: **6px** nos cards de tela e miniaturas; **9–12px** em botões e itens de modal; **16px** em modais.
- Espaçamento: **1px** entre telas (grade e miniaturas) e **4px** de padding nas margens da área principal.
- Transições: 150–250ms `ease` para cores, bordas e opacidade.
- Acessibilidade: todo botão tem `:focus-visible` com contorno de 2px na cor `accent`; todo ícone tem `title` (tooltip) descritivo.

---

## 3. Layout geral

**Nada na interface é texto selecionável** (decisão do dono, 2026-09-18): `user-select: none` no
`body`, com exceção dos campos em que o usuário escreve (`input`, `textarea`). É uma superfície de
controle, não um documento — arrastar sobre um card deixava um rastro azul sobre rótulos que
ninguém copia, e na parede arrastar é como se mira uma tela.

```
┌──┬──────────────────────────────┐
│  │  ┌────────────┐┌────────────┐│
│barra │  Tela 1    ││  Tela 2    ││
│lateral└────────────┘└────────────┘│
│  │  ┌────────────┐┌────────────┐│
│  │  │  Tela 3    ││  Tela 4    ││
│  │  └────────────┘└────────────┘│
└──┴──────────────────────────────┘
```

- A barra lateral fica **grudada à borda esquerda da janela**: sem margem esquerda, cantos arredondados **apenas no lado direito** (`0 10px 10px 0`), margem vertical de 2px, sem borda no lado esquerdo.
- Área principal com padding de 4px e grade com **gap de 1px** — as telas ficam praticamente coladas, para que a parede leia como uma superfície só e cada pixel economizado vá para os jogos. A borda própria de cada card é o que ainda marca a divisão.

---

## 4. Barra lateral

Largura **38px**, apenas botões de ícone (28×28px, ícones de 16px), sem texto. Estreitada de 50px em 2026-09-18 junto com as barras do card; tudo dentro dela desceu na mesma proporção, porque uma régua de 38px em volta de botões de 36px não deixa respiro nenhum. De cima para baixo:

1. **Logo** — quadrado 24×24px com gradiente no `accent` e a letra "H".
2. **Ligar/Desligar todas** — ícone de power.
   - Quando **nem todas** as telas estão ligadas: verde (`accent` + `accentSoft`), tooltip "Ligar todas as telas". Ao clicar, liga apenas as telas desligadas.
   - Quando **todas** estão ligadas: vermelho (`danger` + `dangerSoft`), tooltip "Desligar todas as telas".
3. **Adicionar tela** — ícone `+`. Ativo apenas com menos de 4 telas; desabilitado mantém o mesmo estilo dos demais botões com **opacidade 0.45** (não muda a cor do ícone), cursor `not-allowed`, tooltip "Limite de 4 telas atingido". Hover (quando ativo) acende borda e ícone no `accent`.
4. **Perfis** — ícone de duas pessoas. Abre o modal de perfis (§10.2), que desde 2026-09-19 é
   onde tudo sobre perfis acontece; antes disso era uma seção dentro de Configurações.
5. _(espaço flexível)_
6. **Configurações** — ícone de engrenagem, ancorado na base. Abre o modal de configurações.

---

## 5. Card de tela

Estrutura vertical: **cabeçalho → viewport → barra de controles**.

### 5.1 Cabeçalho

As duas barras do card — cabeçalho e controles — têm **metade da altura** que tinham até 2026-09-18: o cabeçalho passou de ~42px para ~22px e a barra de controles de 50px para ~26px. Diminuir só o padding não bastava: em cada barra quem manda na altura é o elemento mais alto, então o favicon e os botões de controle desceram junto.

- **LED de status** (7px, circular) com brilho (`box-shadow`) quando ativo:
  - Verde (`accent`) = em execução
  - Âmbar (`warn`) = carregando
  - Vermelho (`danger`) = erro
  - Cinza (`border`), sem brilho = desligada
- **Nome da tela** (12px, bold). **Clicável**: alterna o modo foco daquela tela (entra se não está em foco; sai se já está). Hover pinta o nome no `accent`.
- **Fechar a janela de login** (20px, ícone de ×, em `warn`; hover em `danger`) — aparece entre o
  nome e o favicon **somente enquanto aquela tela tiver uma janela de login aberta**, e some junto
  com ela. É a saída de um "entrar com o Google" que o usuário não quer terminar: a janela do
  provedor é um segundo navegador sem caminho de volta para o jogo por dentro (decisão do dono,
  2026-09-19). A contagem vem da varredura de 2s que já resgata essas janelas, então o controle pode
  atrasar até um tique em qualquer direção; clicar quando a janela já fechou não faz nada.
- **Favicon** (14×14px, cantos 4px) alinhado à direita — o mesmo ícone da aba do navegador do endereço configurado. Fallback: ícone de globo se o favicon não carregar. Tooltip com o nome/endereço.
  - No protótipo o favicon vinha de `google.com/s2/favicons?domain=...&sz=64`. Na implementação
    real ele é **empacotado no app** (`assets/<id do jogo>.ico`; globo genérico para endereço
    personalizado): sem evento de favicon e sem rede em tempo de execução (§13). Não é o
    `page-favicon-updated` de um `<webview>` — `webviewTag` está desligado pela ADR-0007, e
    `connect-src 'none'` bloquearia a busca de qualquer forma.

Quando a tela está **em execução**, o card ganha borda esverdeada (`accent` a 40%) e um glow sutil.

### 5.2 Viewport

Fundo escuro (`screenOff`) nos dois temas. Conteúdo por estado:

| Estado    | Conteúdo                                                                                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`     | Botão grande centralizado: ícone power + "Ligar" (hover em `accent`)                                                                                                                                                                                                                                  |
| `loading` | Spinner girando em `warn` + "Carregando…"                                                                                                                                                                                                                                                             |
| `on`      | Vazio: a janela do Chrome embutida (reparentada via `SetParent`, ADR-0011) cobre exatamente esta região, e o painel só publica o retângulo em `screens:layout`. **Não é um `<webview>`** — `webviewTag` está desligado (ADR-0007). No protótipo havia o placeholder "▶ conteúdo da tela em execução". |
| `error`   | Ícone de alerta em `danger` + mensagem + botão "Tentar novamente" (com ícone de reload)                                                                                                                                                                                                               |

Mensagens de erro:

- Endereço personalizado vazio → "Endereço não configurado. Edite a tela e informe um endereço."
- Falha de carregamento → "Não foi possível carregar a página."

### 5.3 Barra de controles

Botões de 20×20px com ícones de 16px sobre fundo `panelSoft` — o ícone quase preenche o botão, de propósito: a 13px os glifos viravam manchas parecidas. O `svg` precisa de `flex-shrink: 0`, senão o flex esmaga a largura dele e o tamanho declarado não vale de nada. **Ordem fixa** (esquerda → direita), com um espaçador flexível separando os dois grupos:

**Grupo de uso cotidiano (esquerda):**

1. **Ligar/Desligar** — destacado em `accent` quando a tela está ativa (qualquer estado exceto `off`).
2. **Recarregar** — desabilitado (opacidade 0.45) quando a tela está desligada; o ícone gira durante o carregamento.
3. **Volume** — abre o popover vertical (seção 6). Ícone fica vermelho quando mudo. O botão **não** ganha destaque enquanto o popover está aberto: o popover vive na janela de overlay, e a parede não guarda esse estado.

**Grupo de visualização e gestão (direita):** 4. **Foco** — ícone de mira; destacado em `accent` quando aquela tela está em foco. Alterna o modo foco. 5. **Tela cheia** — alterna entre maximizar/restaurar (ícone muda entre expandir/contrair). 6. **Editar** — abre o modal de edição (seção 8). 7. **Apagar** — ícone de lixeira em `danger`, sempre o último botão (o mais distante das ações frequentes). Abre confirmação (seção 9).

---

## 6. Controle de volume

Popover ancorado **acima** do botão de volume, estilo player de vídeo:

- Porcentagem no topo (10px, tabular).
- **Trilha vertical**: 13px de largura × 77px de altura, cantos totalmente arredondados, preenchimento de baixo para cima em gradiente do `accent`.
- Interação: **clique** define o volume no ponto clicado; **segurar e arrastar** ajusta continuamente (pointer capture — o arrasto continua mesmo saindo da trilha; funciona com mouse e toque, `touch-action: none`).
- Botão de **mudo** (26×26px) na base do popover; quando mudo, borda e ícone em `danger`.
- Volume 0 equivale a mudo; ajustar o volume acima de 0 remove o mudo automaticamente.
- Fecha ao clicar em qualquer lugar fora do popover.

---

## 7. Modo foco

- Ativação: clique no **nome** da tela ou no **botão de foco**; ambos alternam (segunda ativação sai do foco).
- A tela focada ocupa a área principal com todos os controles normais.
- As demais viram **miniaturas** numa fileira inferior:
  - Dividem **igualmente toda a largura** disponível (flex 1, gap 1px).
  - Altura padrão **100px**; conteúdo: LED (a mesma classe `.led` do card, 7px) + nome (11px) no cabeçalho. No corpo, uma tela **em execução** recebe a própria janela do Chrome embutida — o painel publica esse retângulo em `screens:layout`, como no §5.2, e é isso que mantém o mural vivo no modo foco. As demais mostram o estado em texto ("carregando…" / "erro ao carregar" / "desligada").
  - Discretas por padrão (opacidade 0.85); hover acende a borda no `accent` e restaura a opacidade.
  - **Clicar no cabeçalho da miniatura transfere o foco para ela.** No corpo isso só vale quando a tela não está em execução: no corpo de uma tela ligada o clique chega ao jogo, porque ali está a janela do navegador.
- **Divisor arrastável** entre a tela principal e as miniaturas:
  - Faixa de 10px com um grip central (pílula 44×4px); cursor `ns-resize`; grip acende em `accent` no hover.
  - Arrastar redimensiona a altura das miniaturas. Limites: **mínimo 56px**, **máximo 45% da altura da janela**.
  - **Duplo clique restaura os 100px padrão.**
  - A altura escolhida persiste ao trocar o foco entre telas (e deve persistir entre sessões na implementação real).
- Apagar a tela em foco retorna ao modo grade.

---

## 8. Modal de edição (por tela)

Título: "Editar {nome}". Itens, de cima para baixo:

1. **Nome da tela** — campo de texto, máximo 24 caracteres, placeholder "Tela {N}". Atualiza em tempo real; se ficar vazio ao sair do campo, volta ao padrão "Tela {N}".
2. **Manter sessão salva** — toggle (padrão: ativado). Descrição: "Guarda o login desta tela entre reinícios".
3. **Endereço da tela** — seleção:
   - "Poke IdleWorld (padrão)"
   - "Endereço personalizado" → revela campo de URL com ícone de globo, placeholder `https://exemplo.com`.
4. **Limpar cache desta tela** — botão de risco (seção 9) que apaga apenas o cache daquela tela, com confirmação.

---

## 9. Padrão de risco e confirmações

Ações destrutivas seguem **duas camadas de aviso**:

1. **Botão de risco**: fundo `dangerSoft`, borda `danger` a 33% (100% no hover), ícone de alerta, texto em `danger` com descrição da consequência.
2. **Modal de confirmação**: borda avermelhada, ícone de alerta, descrição explícita da consequência, botões "Cancelar" (neutro) e **"Sim, apagar"** (fundo `danger`). Ações não destrutivas usam "Confirmar" em `accent`.

Textos oficiais:

| Ação                            | Título                    | Mensagem                                                                                                                                                     |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Apagar tela                     | Apagar tela               | Os dados desta tela serão arquivados: o cache, os cookies e as senhas salvas nela deixam de ser usados. Use "Limpar dados arquivados" para apagá-los de vez. |
| Limpar cache das telas (global) | Limpar cache das telas?   | O cache de todas as telas será apagado. Sessões salvas podem precisar de novo login.                                                                         |
| Limpar dados arquivados         | Excluir dados arquivados? | Esta ação é permanente e não pode ser desfeita. Os dados arquivados serão perdidos para sempre.                                                              |
| Limpar cache de uma tela        | Limpar cache da {nome}?   | O cache desta tela será apagado. A sessão salva pode exigir novo login.                                                                                      |

Observação de comportamento: apagar uma tela **arquiva** o perfil do slot (não exclui os dados). Ao readicionar uma tela, ela reutiliza o menor número de slot vago — a implementação deve definir se restaura o perfil arquivado daquele slot.

---

## 10. Modal de configurações

**Quatro categorias**, cada uma com um cabeçalho: o nome em caixa alta, na cor do texto, seguido de
uma régua de 2px que atravessa o resto da linha (`settings-section`). Substituíram os divisores
finos com rótulo apagado que havia antes — o dono não conseguia ver onde um grupo terminava e o
outro começava, que é justamente para o que serve um título. A "Zona de risco" usa a mesma forma em
`danger`.

A ordem é a de quem usa: como o app parece e soa, o aplicativo em si, onde ficam os arquivos e, por
último, o que não tem volta. **Perfis saíram daqui em 2026-09-19** e têm modal próprio (§10.2), com
entrada na barra lateral.

1. **Aparência e som** — **Tema**, controle segmentado Claro/Escuro com ícones de sol/lua (a opção
   ativa em `accent`), e **Áudio apenas na tela em foco**, toggle com estado claramente visível
   (fundo `accentSoft` + borda `accent` + interruptor deslizante quando ativo). Descrição:
   "Silencia automaticamente as telas fora de foco". Integra-se ao modo foco (seção 7).
2. **Aplicativo** — **Versão + Procurar atualizações** (a única ação **do usuário** que toca a
   rede; a outra é a verificação automática de abertura, §10.1 — ADR-0014 e ADR-0023),
   **Novidades da versão {N}** (só quando o `CHANGELOG.md` tem seção para a
   versão em execução), **Aviso sobre os termos do jogo** e **Abrir logs**.
3. **Seus dados** — onde os dados ficam, a divulgação sobre senhas salvas pelo navegador, e **Abrir
   pasta dos dados**.
4. **Zona de risco** — **três** botões:
   - **Limpar cache das telas**
   - **Limpar dados arquivados**
   - **Apagar todos os perfis** — apaga `%APPDATA%/hecaton` inteiro, sessões logadas incluídas, e
     fecha o app, porque não sobra perfil nenhum para adotar. A confirmação avisa, com essas
     palavras, que outra janela aberta perde os dados no meio do uso. Fica desabilitado enquanto
     houver tela aberta nesta janela.

   Apagar **um** perfil saiu daqui e vive em §10.2, ao lado do perfil que apaga. As duas ações
   continuam sendo as **únicas** do produto que apagam um perfil vivo — este documento já omitiu
   esse inventário uma vez, o mesmo erro que a Correção de 2026-08-08 da ADR-0008 teve de
   consertar.

### 10.1 Atualização disponível (modal de abertura)

Aparece sozinho, uma vez por abertura, quando a verificação automática encontra versão nova que o
usuário ainda não dispensou (ADR-0023). É desenhado pela **parede**, como o de novidades, porque
abre antes de qualquer tela estar embutida. Traz a versão publicada, a que está rodando, as notas da
release em `pre` (texto puro, nunca markup — veio da rede) e três ações, da menos para a mais
enfática: **Não lembrar mais** e **Lembrar depois** neutros, **Atualizar agora** em `primary`.
Fechar no X ou no Escape equivale a "lembrar depois": nada é gravado.

### 10.2 Modal de perfis

Aberto pelo botão de perfis na barra lateral (§4), e é o único lugar onde perfis são criados,
renomeados, trocados e apagados. Estava dentro de Configurações até 2026-09-19.

**Uma linha por perfil**, na ordem dos ids: o nome (botão que entra naquele perfil), um lápis e uma
lixeira. A linha do perfil desta janela traz o selo **ESTA JANELA** em `accent` e o nome não é
clicável — não há para onde ir — mas não fica apagada como um controle recusado, porque não é
recusa.

- **Entrar** passa pela confirmação não destrutiva da seção 9: as telas desta janela são
  desligadas e as do outro perfil assumem. Se o perfil escolhido estiver aberto em outra janela, a
  recusa aparece no próprio modal.
- **Renomear** troca a linha por um campo de texto com salvar e cancelar (Enter salva, Esc
  cancela). Renomear **outro** perfil escreve no `config.json` dele, então o processo principal
  toma a trava daquele perfil antes e recusa quando outra janela o mantém aberto — a regra decidida
  pelo dono em 2026-09-19 e a razão de o canal poder carregar um id.
- **Apagar** pede a confirmação destrutiva. No perfil desta janela vale a regra de sempre: as telas
  precisam estar paradas, a janela adota outro perfil e a ação é recusada quando não há nenhum
  livre. Em outro perfil, a trava é a garantia: um perfil aberto em outra janela não é apagado.

Abaixo da lista, dois botões neutros e do mesmo peso — **Criar novo perfil**, que cria e deixa a
janela onde está (o perfil entra na lista e é o que o próximo Hecaton abre), e **Criar outro perfil
e ir para ele**, que passa pela confirmação porque desliga as telas daqui.

Diferente dos outros modais, este **se redesenha** quando chega estado novo: tudo nele é uma visão
do que existe em disco, e a resposta de uma ação e o empurrão de estado que a segue chegam em
qualquer ordem. Um nome sendo digitado suspende o redesenho até o campo fechar.

---

## 11. Tela cheia

- Cobre **toda a janela da aplicação**, inclusive a barra lateral (`position: fixed; inset: 0`), sem bordas nem arredondamento — comportamento de player de vídeo.
- O card mantém cabeçalho e barra de controles; o botão de tela cheia vira "restaurar".
- Independente do modo foco: é possível focar uma tela e depois maximizá-la.

---

## 12. Feedback (toasts)

Notificações transitórias (~2,6s) em pílula centralizada na base da área principal. Mensagens em
uso, conferidas contra as treze chamadas de `showToast` no renderer (doze textos distintos — "Abrindo no
navegador…" aparece em duas): "Ligando todas as telas…", "Todas as telas desligadas",
"Tela adicionada", "Abrindo logs…", "Cache das telas limpo", "Cache da {nome} limpo", "Dados
arquivados excluídos", "Abrindo no navegador…", "Abrindo pasta…", "Dados apagados. Fechando o
aplicativo…", "Agora em {perfil}" e "Perfil renomeado para {nome}". **O que não é toast**, e de
propósito: criar um perfil sem ir para ele, as três recusas de troca de perfil e a recusa de apagar
o perfil aparecem **dentro do modal**, em `.account-status` — o modal vive na janela de overlay, que
não tem faixa de toast, e é para onde o usuário está olhando. Apagar um perfil também não emite
toast próprio: quem anuncia é a parede, com "Agora em {perfil}", quando a janela adota o próximo. Remover uma tela **não** emite toast: a remoção empurra o estado e a grade se redesenha sozinha.

---

## 13. Notas para a implementação real (Chrome reparentado)

> Reescrita em 2026-07-22. A versão original assumia webview do Electron; a arquitetura
> decidida ([ADR-0011](../adr/0011-embed-spawned-chrome-into-the-shell.md)) reparenta janelas de Chrome real via
> Win32 `SetParent` — as telas **não são `webContents`**, e as APIs do Electron não as
> alcançam. Cada nota abaixo aponta o equivalente medido no spike da Etapa 0, cujos findings
> estão no ADR-0011.

- **Estados de tela**: não há eventos `did-*` para janelas de outro processo. `loading` =
  slot lançado e janela ainda não resolvida/embutida; `on` = PID resolvido e janela
  embutida; `error` = falha de lançamento ou processo morto (detecção de vida por
  `process.kill(pid, 0)`, como hoje). A simulação de falha aleatória do protótipo (15%)
  existe apenas para demonstrar o estado de erro e **não deve ser portada**.
- **Favicon**: **empacotado no app** (ícone do Poke IdleWorld; globo genérico para endereço
  personalizado). Sem evento de favicon e sem rede em tempo de execução —
  `connect-src 'none'` permanece.
- **Persistência** (já planejada): configurações por tela (nome, endereço, sessão, volume,
  mudo, throttling), tema, estado do "áudio em foco" e altura das miniaturas.
- **Interação com a tela embutida** (obrigações medidas no spike): o shell encaminha o foco
  de teclado ao clicar numa tela (`WM_PARENTNOTIFY` via `hookWindowMessage` +
  `AttachThreadInput`/`SetFocus`); reafirma `HWND_TOP` do filho em cada sync de bounds
  (`movechild`), e **não** em mudanças de ativação — a obrigação 0.1 do ADR-0011 previa isso e
  nunca foi implementada (ver a Correção de 2026-08-20 nesse ADR); **esconde (`SW_HIDE`) apenas a tela que um modal desenhado no próprio
  painel realmente cobre**, porque a janela nativa pinta por cima do DOM — as demais seguem
  visíveis. Três correções em relação ao que este documento dizia antes, todas conferidas no
  código: não há encaminhamento de foco no evento `focus` da BrowserWindow (só o
  `WM_PARENTNOTIFY`), não há reafirmação de z-order na ativação, e um modal não esconde a grade
  inteira. O popover de volume e quase todos os modais vivem na janela overlay — que
  **não** é always-on-top desde 2026-09-18: ela é _owned_ pelo painel, o que já basta para pintar
  acima das telas embutidas sem cobrir os outros programas da máquina (ADR-0011 e sua Correção) — e
  não escondem tela alguma. Os desenhados no próprio painel são três: o portão dos termos, o de
  novidades da versão e o de atualização disponível (§10.1).
- **Recarregar**: `WM_APPCOMMAND` com `APPCOMMAND_BROWSER_REFRESH` (código **3**) direto na
  janela embutida — sem foco, sem clique, ~310ms. É a **única** operação que preserva o
  login do jogo (sessão presa à aba, ADR-0009): navegar e voltar, reabrir ou nova aba
  perdem a sessão.
- **Atalhos de teclado** (futuro): `before-input-event` não existe para janelas alheias.
  Atalhos do painel só são capturáveis enquanto o teclado está no renderer do próprio
  painel; com um jogo em foco, a tecla vai para o Chrome. Se atalhos globais dentro do app
  forem desejados, a opção honesta é reencaminhá-los a partir do estado de foco que o shell
  já rastreia — decisão adiada para a implementação. Evitar `globalShortcut` (escopo de
  sistema) continua valendo.
- **Áudio em foco**: silenciar/restaurar via WASAPI por processo (mute existente + volume
  por `ISimpleAudioVolume.SetMasterVolume` no worker PowerShell persistente — p95 de 13ms
  por ajuste, medido). Não há `setAudioMuted` de webContents para janelas alheias.
- **Popups** (`window.open` do jogo): abrem como janelas soltas no desktop, fora do painel —
  comportamento medido; o tratamento de UX é decisão da implementação.

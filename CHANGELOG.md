# Changelog

O que mudou em cada versão. O aplicativo mostra a seção da versão que você está
rodando, uma vez, logo depois de atualizar — e este arquivo viaja junto do
executável, como `CHANGELOG.txt`, e sai solto na página da versão, para poder ser
lido sem abrir o aplicativo e antes de instalar qualquer coisa.

Escrito para quem usa, não para quem programa. O histórico técnico completo está
nos commits.

## 0.3.0

Agora dá para abrir vários Hecatons ao mesmo tempo, cada um com as suas telas.

- **Várias janelas, uma conta em cada.** Abrir um segundo Hecaton não é mais
  recusado: ele abre na segunda conta, e cria uma se ainda não existir. Cada
  conta tem as próprias telas, os próprios logins e o próprio cache — até 4
  telas por conta —, então duas janelas nunca mexem nos mesmos perfis.
- **Contas em Configurações.** Uma lista com todas as contas da máquina, o nome
  desta conta (dá para renomear) e um botão para criar outra e ir para ela.
  Trocar de conta desliga as telas desta janela e carrega as da outra; nada é
  apagado. Se a conta escolhida já estiver aberta em outra janela, o aplicativo
  avisa em vez de abrir duas vezes a mesma.
- **Mais tela de jogo e menos moldura.** As barras de cima e de baixo de cada
  tela ficaram com metade da altura, o espaço entre as telas caiu para 1 pixel e
  a barra lateral ficou mais estreita. Nada mudou de lugar — tudo o que estava
  ali continua ali, só que menor.
- **Os ícones das telas voltaram a ser legíveis.** Eles estavam sendo espremidos
  para uns 6 pixels de largura por um detalhe de layout, e por isso pareciam
  manchas parecidas. Agora cada um ocupa o botão inteiro.
- **Apagar dados agora são dois botões.** _Apagar os dados desta conta_ mexe só
  na conta em que você está; _Apagar TODOS os dados_ continua apagando tudo, de
  todas as contas — e avisa que outra janela aberta perde os dados dela junto.

**Sobre as telas em segundo plano**: foi medido, e elas não desaceleram. Com o
aplicativo fora de foco, coberto por outra janela, minimizado, e até com o
monitor desligado pela economia de energia do Windows, o relógio das páginas
continuou em 1 tique por segundo, sem perder nenhum. O que para com o monitor
desligado é só o desenho na tela — que é o que "monitor desligado" quer dizer.
Suspender o computador é outra coisa: aí o Windows congela tudo.

**Na primeira vez que você abrir esta versão**, suas telas e seus logins passam
a morar dentro de `%APPDATA%/hecaton/accounts/1`. O aplicativo faz isso
sozinho, movendo as pastas (nada é copiado nem apagado), e você continua logado
como estava. Se algo der errado no meio, ele não abre e nada é perdido — as
pastas ficam onde estavam.

## 0.2.1

Correção de um problema que aparecia na hora de entrar na conta.

- **A janela de login agora aparece.** Quando o jogo abria uma janela para você
  entrar com uma conta de outro serviço (Google, por exemplo), ela nascia fora
  da área visível da tela: existia na barra de tarefas, mas não dava para ver
  nem usar. Agora o aplicativo traz essa janela para o meio do painel, na
  frente, assim que ela aparece. Uma janela que você mesmo arrastou para outro
  canto fica onde você deixou.

## 0.2.0

O aplicativo passou a se bastar: ele traz o próprio navegador, e continua sendo
uma pasta que você extrai e abre.

- **Não precisa mais ter o Chrome instalado.** O Hecaton traz o navegador dele,
  e é sempre esse que abre as telas. Some daí a pergunta "qual Chrome está
  rodando?" e somem as surpresas quando o seu navegador se atualiza sozinho.
- **Continua sendo baixar, extrair e abrir.** Nada de instalador: você baixa o
  zip, extrai a pasta onde quiser e abre o `Hecaton.exe`. Atualizar é trocar a
  pasta; remover é apagar a pasta — e apagar a pasta **não** apaga seus logins,
  que ficam em `%APPDATA%\hecaton`. Para apagar os logins também existe
  _Configurações → Zona de risco → Apagar todos os meus dados_.
- **Um Hecaton por computador.** Abrir um segundo agora avisa em vez de duas
  cópias disputarem os mesmos perfis.
- Os relatórios de erro não guardam mais o nome da sua conta do Windows.

**Se você usava a 0.1.0**, extraia esta versão numa pasta nova e apague a antiga
quando confirmar que tudo abre. Seus logins não estão dentro dela: ficam em
`%APPDATA%\hecaton`, e as duas versões usam os mesmos.

## 0.1.0

Primeira versão.

- Várias contas do mesmo jogo lado a lado, cada uma na sua própria sessão do
  Chrome, organizadas dentro de uma janela só.
- Modo foco: uma tela ocupa o painel inteiro, e o áudio segue quem está em foco.
- Volume e mudo por tela.
- Reinício automático de uma tela que travar.
- **Aviso sobre os termos do jogo** na primeira execução, e sempre relegível em
  Configurações.
- **Seus dados**: onde ficam seus logins, e um botão para apagar tudo.
- **Procurar atualizações**, só quando você pede — o aplicativo não fala com a
  rede em nenhum outro momento.

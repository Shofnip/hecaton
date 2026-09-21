# Changelog

O que mudou em cada versão. O aplicativo mostra a seção da versão que você está
rodando, uma vez, logo depois de atualizar — e este arquivo viaja junto do
executável, como `CHANGELOG.txt`, e sai solto na página da versão, para poder ser
lido sem abrir o aplicativo e antes de instalar qualquer coisa.

Escrito para quem usa, não para quem programa. O histórico técnico completo está
nos commits.

## 0.5.0

Zoom e barra lateral agora podem ser ajustados do seu jeito, sem atrapalhar a
parede de jogos.

- **Zoom por tela.** O botão de lupa abre um controle vertical de 25% a 200%,
  com a porcentagem visível enquanto você arrasta. O modo **Auto** continua
  ajustando o jogo ao tamanho do card; ao desligá-lo, o valor escolhido vale na
  grade, no foco e na tela cheia e fica salvo para a próxima vez. O balão que o
  Chromium mostrava por cima do jogo ao mudar o zoom não aparece mais.
- **Uma barra lateral que sai do caminho.** Os botões de ligar todas, adicionar
  e perfis podem ser reordenados arrastando. A seta na base recolhe a barra para
  uma faixa fina e a expande de novo; no modo foco ela desaparece por inteiro.
  A ordem e o recolhimento duram só até fechar esta janela, então cada abertura
  começa no arranjo original.
- **Iniciar várias telas ficou confiável.** Uma tela que demorava a abrir podia
  gastar sua posição e sua ordem de aparecer antes de entrar no painel, ficando
  preta, pequena ou fora do lugar. A posição agora espera o encaixe terminar.
- **Ligar todas ficou rápido sem travar o painel.** As telas agora começam juntas,
  e uma que falhar não impede as outras de abrir. Um segundo clique é ignorado
  até essa rodada terminar. Desligar todas continua acontecendo em paralelo.
- **O cursor não dá mais uma pausa a cada dois segundos.** A verificação das
  janelas de login saiu do relógio: ela acontece apenas quando o Hecaton ganha ou
  perde foco, fora da interface, e a parede não é redesenhada quando nada mudou.
- **Redimensionar mantém cada jogo no seu card.** Quando os movimentos chegavam
  mais rápido que o Windows conseguia aplicá-los, a posição nova de uma tela
  podia ser descartada pela mudança seguinte de outra. Os movimentos pendentes
  agora são combinados por tela e a posição final é conferida uma vez quando o
  movimento termina, sem fila atrasada, saltos antigos ou faixas pretas persistentes.
- **Desligar todas ficou rápido.** O pedido de fechamento agora chega à janela
  antes de o aplicativo esquecer como encontrá-la, evitando esperar pelo prazo
  de encerramento forçado de cada navegador.
- **Ligar tudo de novo não perde telas.** O Windows pode reutilizar os números
  dos processos logo depois de um desligamento em grupo; o Hecaton agora limpa
  todos os dados da janela antiga antes que esse número seja usado de novo.
- **Popovers mais previsíveis.** Volume e zoom continuam abrindo por clique ou
  por uma breve pausa do mouse, mas não fecham no meio de um arrasto e não
  confundem a passagem do ponteiro com um clique.
- **Navegador atualizado.** O Chromium incluído passou para 156.0.8067.0.

## 0.4.0

As telas agora ficam na ordem que você escolher, e o jogo cabe dentro da carta.

- **Arraste para reordenar as telas.** Pegue uma tela pelo cabeçalho e solte-a em
  cima de outra: elas trocam de lugar na parede, e a ordem fica salva. O número
  da tela **não** vai junto — a "Tela 2" continua sendo a Tela 2 depois de ir
  para o primeiro quadro, porque é o número que guarda o login dela. Enquanto
  você arrasta, o cabeçalho da tela que está indo fica esmaecido e o da tela onde
  ela cairia ganha uma faixa verde em cima. Um clique que não anda continua
  abrindo o modo foco, como antes. Só na grade: na tela cheia e no modo foco não
  há para onde soltar.
- **O jogo cabe na carta.** Cada tela agora ajusta o zoom sozinha ao tamanho do
  card, mirando um espaço de 1920×1080 dentro dele, e volta a 100% quando você
  entra no modo foco — onde há espaço para ler. Ao sair do foco, ela volta ao
  zoom do card sem recarregar nem derrubar a sessão do jogo.
- **Voltou a dar para clicar depois de trocar de programa.** Clicar num campo de
  login, ir para outro aplicativo e voltar podia deixar a tela sem responder ao
  mouse ou ao teclado, às vezes com o cursor sumindo. A janela do jogo estava
  ficando por baixo da camada de entrada do próprio Hecaton; agora essa ordem é
  reposta toda vez que a janela volta a ficar ativa.
- **As telas pararam de perder sete pixels do topo.** Todas as telas vinham com a
  primeira faixa de sete pixels cortada — nada num jogo parece errado quando
  falta isso, e foi o que fez o problema durar. Agora o recorte bate.
- **As telas se movem bem mais rápido.** Entrar e sair do foco, e arrastar o
  divisor, deixaram de arrastar um rastro: medido em seis telas, a transição de
  foco caiu de 75 ms para 36 ms e a corrida atrás do divisor de 2,2 s para 84 ms.
- **O divisor do modo foco ficou mais fino.** A barra de arrastar entre a tela em
  foco e as miniaturas passou de 10 para 7 pixels. Os limites continuam os
  mesmos, inclusive o duplo clique que devolve a altura padrão.

## 0.3.0

Agora dá para abrir vários Hecatons ao mesmo tempo, cada um com as suas telas.

- **Várias janelas, um perfil em cada.** Abrir um segundo Hecaton não é mais
  recusado: ele abre no segundo perfil, e cria um se ainda não existir. Cada
  perfil tem as próprias telas, os próprios logins e o próprio cache — até 4
  telas por perfil —, então duas janelas nunca mexem nas mesmas telas.
- **Perfis, na barra da esquerda.** Um botão só para eles abre a lista com todos
  os perfis da máquina: entrar em um, renomear, apagar e criar. Trocar de perfil
  desliga as telas desta janela e carrega as do outro; nada é apagado. Se o
  perfil escolhido já estiver aberto em outra janela, o aplicativo diz isso ali
  mesmo, em vez de não fazer nada.
- **Mais tela de jogo e menos moldura.** As barras de cima e de baixo de cada
  tela ficaram com metade da altura, o espaço entre as telas caiu para 1 pixel e
  a barra lateral ficou mais estreita. Nada mudou de lugar — tudo o que estava
  ali continua ali, só que menor.
- **Os ícones das telas voltaram a ser legíveis.** Eles estavam sendo espremidos
  para uns 6 pixels de largura por um detalhe de layout, e por isso pareciam
  manchas parecidas. Agora cada um ocupa o botão inteiro.
- **Aviso quando sai uma versão nova.** Ao abrir, o Hecaton pergunta ao GitHub se há versão
  mais recente e, se houver, avisa uma vez com três respostas: _Atualizar agora_ abre a
  página da versão no seu navegador, _Lembrar depois_ volta a avisar na próxima abertura, e
  _Não lembrar mais_ silencia **aquela** versão neste perfil — a seguinte avisa de
  novo. Nada é enviado
  junto: nem quem você é, nem qual versão está usando. Nada é baixado nem instalado pelo
  aplicativo, como antes. Sem internet, ele não diz nada. _Configurações → Procurar
  atualizações_ continua onde estava, para quando você quiser perguntar na hora.
- **Dá para desistir do login do Google.** Quando uma tela abre a janela de
  login do provedor, aparece um × no cabeçalho dela; ele fecha essa janela e
  deixa a tela como estava. Antes, aberta a janela, só havia o caminho de
  frente. O botão só existe enquanto a janela existir.
- **Tibidle.** O segundo jogo da lista, com o ícone dele nas telas. Escolha em
  _Editar tela → Jogo_, como o Poke IdleWorld.
- **Perfis agora têm janela própria.** Um botão novo na barra da esquerda abre a
  lista de todos os perfis da máquina. Dá para **renomear e apagar qualquer
  perfil sem entrar nele** — se o perfil estiver aberto em outra janela do
  Hecaton, o aplicativo recusa e diz isso, em vez de mexer nos dados de quem
  está usando. Criar, renomear, trocar e apagar ficam todos aqui; a seção Perfil
  saiu de Configurações.
- **Os botões reagem ao mouse.** Passar o cursor por qualquer botão, campo ou
  lista agora acende a borda e o fundo, e clicar afunda o botão 1 pixel. Antes
  só cinco controles faziam isso, e quais eram era acidente de ordem de escrita.
- **Configurações em quatro categorias.** Perfil, Aparência e som, Aplicativo, Seus dados e
  Zona de risco, cada uma com título e uma linha que atravessa a largura — antes eram três
  blocos separados por um fio fino, e não dava para ver onde um terminava.
- **Dois jeitos de criar um perfil.** _Criar novo perfil_ cria e deixa você onde
  está: o perfil novo entra na lista e é o que o próximo Hecaton abre. _Criar
  outro perfil e ir para ele_ continua fazendo as duas coisas.
- **O modal de configurações não fica mais na frente de tudo.** Ele cobria qualquer outro
  programa da máquina enquanto estava aberto; agora fica na frente das telas do jogo, que é
  o que precisava, e atrás da janela que você colocar na frente.
- **O texto da interface não é mais selecionável.** Arrastar o mouse sobre um card não deixa
  mais aquele rastro azul. Nos campos em que você escreve, selecionar continua funcionando.
- **Apagar dados agora são dois botões.** _Apagar este perfil_ mexe só no perfil
  em que você está, e a janela continua aberta, em outro perfil; _Apagar todos
  os perfis_ apaga tudo e fecha o aplicativo — e avisa que outra janela aberta
  perde os dados dela junto. Se não houver outro perfil livre para assumir a
  janela — é o único, ou os outros estão abertos em outras janelas —, apagar é
  recusado e **nada** é apagado: o aplicativo diz isso e recomenda limpar o
  cache das telas, que é o que costuma se querer dizer.

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

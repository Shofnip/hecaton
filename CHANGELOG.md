# Changelog

O que mudou em cada versão. O aplicativo mostra a seção da versão que você está
rodando, uma vez, logo depois de atualizar — e este arquivo viaja junto do
executável, como `CHANGELOG.txt`, e sai solto na página da versão, para poder ser
lido sem abrir o aplicativo e antes de instalar qualquer coisa.

Escrito para quem usa, não para quem programa. O histórico técnico completo está
nos commits.

## 0.2.0

O aplicativo passou a se bastar: ele traz o próprio navegador e vem em um
instalador.

- **Não precisa mais ter o Chrome instalado.** O Hecaton traz o navegador dele,
  e é sempre esse que abre as telas. Some daí a pergunta "qual Chrome está
  rodando?" e somem as surpresas quando o seu navegador se atualiza sozinho.
- **Instalador no lugar da pasta zipada.** Você escolhe onde instalar, aparece
  em _Aplicativos e recursos_ e tem atalho no menu Iniciar. Desinstalar **não**
  apaga seus logins — para isso continua existindo _Configurações → Zona de
  risco → Apagar todos os meus dados_.
- **Um Hecaton por computador.** Abrir um segundo agora avisa em vez de duas
  cópias disputarem os mesmos perfis.
- Os relatórios de erro não guardam mais o nome da sua conta do Windows.

**Se você usava a 0.1.0**, a pasta que você extraiu do zip continua onde estava —
o instalador não conhece e não remove ela. Depois de conferir que a versão nova
abre, pode apagar essa pasta à mão. Seus logins não estão lá dentro: eles ficam
em `%APPDATA%\hecaton` e as duas versões usam os mesmos.

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

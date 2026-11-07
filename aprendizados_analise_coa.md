# Aprendizados — Análise diária COA (Solinftec SGPA)

Lido no início de cada execução. Versão CONSOLIDADA em 05/11/2026 (o diário completo de 09/10 a 05/11 está em aprendizados_analise_coa_arquivo.md — NÃO ler, só consultar se algo der errado). Manter este arquivo com até ~10 KB: no fim de cada execução acrescente no máximo 1–3 linhas datadas em "Registro recente"; quando ele passar de ~10 KB, mova as linhas mais antigas do Registro recente para o arquivo e atualize as seções fixas.

## Técnica que funciona (SGPA — Relatório de Variáveis Operacionais COA)
- Relatório é Power BI dentro do web component wc-solinftec-power-bi (shadow DOM). Ler dados com powerbi.embeds + visual.exportData (nunca pelo gráfico). Após setFilters aguardar ≥4 s e comparar a assinatura do export (não ler dado antigo).
- Login: 2×F5 costuma deixar logado; se cair no login com usuário/senha preenchidos, Iniciar sessão funciona. O JS lê a senha autopreenchida como vazia (segurança do Chrome) — conferir pelo screenshot. Se a aba/grupo do Chrome sumir, recriar com tabs_context createIfEmpty.
- Filtros (listas paginadas com reticências): usar __tickAll percorrendo com aria-label "Previous page"/"Next page" — não vem nos helpers do prompt, recriar. GRUPO (9), TIPO (2), EQUIPAMENTO (~116–120, "Selecionar todos" pelo ícone), OPERAÇÃO (336: a lista tem 347 códigos; conferir pelos 11 desmarcados, não pelo número). getFilters traz 338 valores incluindo -1 (normal). Rodar o __tickAll de OPERAÇÃO como promise (pode passar de 45 s).
- Se o painel de filtros fechar, reabrir pelo botão azul de filtro (os filtros ficam guardados). Se a lista ficar vazia (só "Selecionar todos"), recarregar a página.
- javascript_tool: nunca esperar mais de ~40 s numa chamada (limite 45 s); o que demora roda como promise em segundo plano (window.__bg/__log) e é consultado depois. Saída do javascript_tool é cortada (~1000 caracteres).
- coa_extract.js: colar inteiro e rodar passo1→passo2→passoPML/cruzCaminhao→excluidas numa única promise (~7–8 min, ~5 s por export). Matriz de operações por frente×tipo (18 exports) bate com o total. Montar no próprio JS as métricas/esqueleto final das frentes e só então ler (meta: ≤25 KB no total).
- Operações excluídas (chuva, Indeterminado, oficina, pátio, Parada Indústria...): report.setFilters sem "Operacao Cod" + filtro de página dOperacao."Operacao Cod" In [código numérico] (um por vez) → exportar por frente/tipo/equipamento/hora → RESTAURAR o filtro (338). Equipamento com 24 h em operação excluída nem aparece na matriz de eficiência.
- Aba "Parado com Motor Ligado": matriz 924040e08209c2c21772 e gráfico d78baf9385b661eceb88; horas por operação = Tempo em Parada (h) × % (a coluna em horas vem arredondada). Valores por hora/operador têm 0,1 h de precisão.
- Se coa_extract.js / caminhao_coa.py sumirem das pastas, recriar a partir da seção MÉTRICAS do prompt e salvar nas duas pastas (Downloads e Área de Trabalho\historico).
- Screenshot pode travar (CDP timeout) no SGPA e logo após o login do LOGTRAC: seguir por javascript_tool / find / get_page_text.

## LOGTRAC (entrega x cota, desde 30/10/2026)
- Login talamanteneto já preenchido pelo Chrome → Log In → imagem BIOAROEIRA → abrir direto f?p=200:210:<sessão>:::210:P1_NODE:115 (clicar no menu não navega).
- Datas: digitar no campo falha (volta a data de hoje) → usar apex.item('P210_FILTRO_DTAINICIAL').setValue('DD/MM/AAAA 00:00:00') e apex.item('P210_FILTRO_DTAFINAL').setValue('DD/MM/AAAA 23:59:59') + Consultar; tabela pronta em ~15 s.
- Rodar o LOGTRAC numa 2ª aba enquanto o SGPA exporta (nunca navegar a aba do SGPA durante o export).
- Erro "ORA-20001 Parâmetro vlrMinPalhada não cadastrado para a frente 104 e tipo de equipamento 219" (31/10 a 03/11) é cadastro no LOGTRAC, não filtro → entregaCota null e avisar o usuário. Voltou a funcionar em 04/11.
- Solinftec Flow NÃO é mais usado (regra do usuário de 30/10). Regra antiga, só se o Flow voltar: a "FRENTE 31" do Flow é a Frente 11 (somar só a entrega, não a cota).

## Escrita (padrão do usuário desde 11/10)
- Parágrafo simplificado: frases curtas, um fato por frase, começar pelo principal; número sempre com a referência ("98,4%, referência 85%"), equipamento e horário. Um gerente e um assistente devem entender sem explicação.
- Motor ligado parado em cada frente quando relevante; no resumo SEMPRE: total do dia (h e %), principais apontamentos somando colhedora + transbordo (dizendo o tipo) e TODAS as frentes em ordem de horas, cada uma com horas e os 2 apontamentos principais (pedido de 19/10).
- Citar o que tirou horas da análise (ex.: "a chuva tirou X h das colhedoras") — o usuário gostou dessa explicação (15/10).

## Leitura dos dados (regras do usuário)
- 568 INDETERMINADO = equipamento OFFLINE, sem conectividade: escrever "sem informação por falta de conectividade (Indeterminado)" / "offline", nunca "parado"/"não trabalhou"; avisar que a leitura daquele horário fica incompleta; ação = verificar conectividade/telemetria.
- Eficiência e Disponibilidade por frente = média ponderada pelas horas apontadas (equipamento inativo 24 h derruba a média — citar).
- Terceiros (11, 13, 34, 37) com equipamento 24 h Sem Apontamento/Inativo = problema de apontamento/disponibilidade, não de logística.
- Quando o SGPA mostrar a frente sem dados mas houver entrada no LOGTRAC, dizer que a frente entregou (ex. F34 em 22/10, F13 em 25/10).
- "Aguardando Caminhão de Cota" é operação diferente de "Aguardando Caminhão" e não entra no cruzamento M10.
- Equipamento apontado 24 h numa espera com motor desligado (ex. 961257 em "Equipamento em Fila" em 01/11) distorce o indicador — citar como apontamento parado.

## Padrões recorrentes (situação em 04/11/2026 — atualizar quando mudar)
- F02: colhedoras aguardando transbordo acima de 10% em todo dia com colheita desde 24/10 (12 dias seguidos até 05/11), com transbordos em corretiva (30074, 30058, 30142) e também aguardando colhedora (alocação).
- F04: aguardando transbordo há 7 dias seguidos (até 05/11); 10114 em corretiva repetida desde 29/10.
- F05: aguardando transbordo há 6 dias; falta de caminhão recorrente à noite (16 registros até 03/11; 04/11 sem falta); 30085 em corretiva desde 31/10.
- F01: fila recorrente com transbordo sobrando (7 transbordos para 2 colhedoras) → sugerir remanejar; 20024/20025/20120 com manutenção frequente (20025 é de 2 linhas).
- F03: falta de caminhão à noite (3 registros em 6 dias até 04/11); offline recorrente — 20023 offline 24 h há 15 dias (até 05/11).
- F11: possível divergência de Aguardando Caminhão recorrente; 961073 inativa, 960648 pátio, 961138/961268 oficina.
- F13: abaixo da cota quase todo dia desde 22/10 (0 t no LOGTRAC de 03 a 06/11, 4 dias apesar de colheita no SGPA — conferir lançamento); 960787 offline.
- F34: muitas máquinas offline (961327/961329/961398/961333); 961330/961331 sem apontamento.
- F37: 961365/961370 offline 24 h recorrentes; transbordo sobrando às vezes.
- Motor ligado parado do dia fica entre ~11% e ~14% do motor ligado.

## Registro recente (1–3 linhas por execução)
- 2026-11-05 (dados de 04/11): fluxo normal; LOGTRAC numa 2ª aba sem o ORA-20001 (2º dia); esqueleto compacto de 13 KB.
- 2026-11-06 (dados de 05/11): fluxo normal (data já vinha em ontem; login automático nos dois sistemas). Chuva só na F01 (00h–20h). F13 3º dia sem entrada no LOGTRAC. F37: 961370 apontado 24 h em Fatores Climáticos sem chuva na frente (conferir apontamento). browser_batch com 10 waits de 10 s estourou o tempo — usar no máx. ~6 waits por batch.
- 2026-11-07 (dados de 06/11): fluxo normal (login automático nos dois sistemas; LOGTRAC lido antes do fim do export). F03 com cota nominal 0 e entrada 2.842 t → pct null. Chuva só na F11 (20h–23h). F37: 961370 em Fatores Climáticos 24 h pelo 2º dia. Falta de caminhão forte na F03 às 14h.

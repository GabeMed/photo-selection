# face-service

Serviço HTTP sem estado que abre uma imagem e devolve o que há nela: dimensões, rostos (caixa, score e vetor), a versão de tela e a miniatura. É chamado só pelo Worker; não acessa banco nem bucket e não precisa de internet em execução.

## Rotas

- `GET /health` → `200 {"status": "ok"}`. O servidor só passa a aceitar conexões depois de carregar os modelos.
- `POST /analyze` — corpo = bytes crus da imagem (JPEG, HEIC/HEIF, PNG ou WebP). Resposta:

```json
{
  "width": 4032,
  "height": 3024,
  "faces": [{ "box": [0.41, 0.22, 0.08, 0.14], "det_score": 0.89, "embedding_b64": "..." }],
  "preview_b64": "...",
  "thumb_b64": "..."
}
```

- `width` e `height` são da imagem já com a orientação EXIF aplicada.
- `box` é `[x, y, largura, altura]`, normalizado de 0 a 1 sobre a imagem orientada.
- `embedding_b64` é o base64 de 512 `float32` little-endian, vetor de norma 1. A semelhança entre dois rostos é o produto escalar dos vetores.
- `preview_b64` é um JPEG com lado maior de até 2048 px (imagem menor não é ampliada); `thumb_b64`, de até 400 px.
- Imagem ilegível (arquivo corrompido, truncado ou de outro formato) → `422 {"error": "could not read image"}`, sempre com esse texto.
- No máximo 2 análises rodam ao mesmo tempo; os outros pedidos esperam a vez.

## Como detecta

A imagem inteira passa pelo detector em três escalas (lado maior 1920, 640 e 320 px): a maior acha rostos pequenos, as menores acham retratos e selfies de perto, que o detector não enxerga em 1920 px (um rosto que ocupa quase todo o quadro só aparece na de 320 px). As caixas repetidas são eliminadas por sobreposição.

### Blocos: desligados por padrão

Com `FACE_TILES=1`, imagens maiores que 1920 px passam de novo pelo detector em quatro blocos sobrepostos (60% de cada dimensão), para rostos muito pequenos. Fica desligado por padrão porque custa caro e rende pouco:

- os blocos multiplicam o tempo de cada foto (tabela abaixo); em produção, com eles ligados, uma foto de 12 MP e uma de 48 MP em paralelo levaram cerca de 15 s cada, perto de uma hora para 500 fotos;
- eles só acrescentam rostos com menos de ~24 px de altura numa foto de 12 MP, tamanho em que o vetor dificilmente passa do limiar de semelhança.

Para ligar, defina a variável de ambiente `FACE_TILES=1` no container.

## Configuração

| variável | padrão | efeito |
|---|---|---|
| `MODELS_DIR` | (obrigatória) | pasta com `det_10g.onnx` e `w600k_r50.onnx` |
| `FACE_THREADS` | `2` | threads do onnxruntime e do OpenCV; o padrão é o número de vCPUs da instância |
| `FACE_TILES` | `0` | `1` liga a detecção em blocos |

## Tempo por foto

Medido na imagem `linux/amd64` com `--cpus 2 --cpuset-cpus 0,1 --memory 8g`, emulada num Mac ARM (os valores absolutos são maiores que os de uma máquina amd64 real; valem pela proporção). Segundos por foto, três execuções:

| foto | antes (threads sem limite, blocos ligados) | 2 threads, blocos ligados | 2 threads, blocos desligados (padrão) |
|---|---|---|---|
| 12 MP JPEG, 6 rostos | 22,3 a 23,2 | 11,8 a 12,6 | 3,2 a 3,4 |
| 12 MP HEIC, 6 rostos | 19,8 a 25,3 | 12,1 a 12,5 | 3,5 a 3,6 |
| 12 MP JPEG, 29 rostos | 41,7 a 42,9 | 15,5 a 16,1 | 6,2 a 6,5 |
| 48 MP JPEG, 6 rostos | 22,1 a 24,9 | 12,5 a 12,9 | 4,0 |
| 48 MP HEIC, 6 rostos | 22,5 a 24,9 | 13,3 a 13,4 | 4,8 |
| 12 MP e 48 MP ao mesmo tempo | 33 a 38 cada | 21 a 26 cada | 7 a 8 cada |

## Modelos e licença

InsightFace `buffalo_l`: `det_10g.onnx` (detecção) e `w600k_r50.onnx` (reconhecimento), em onnxruntime CPU. Os pesos são baixados na construção da imagem Docker e nunca entram no repositório. **A licença dos pesos do InsightFace é só para pesquisa não comercial.**

## Rodar com Docker

A Cloudflare exige `linux/amd64`:

```sh
docker build --platform linux/amd64 -t photo-selection-face-service:dev .
docker run --rm --platform linux/amd64 --cpus 2 --memory 8g -p 8080:8080 photo-selection-face-service:dev
curl -s --data-binary @foto.jpg http://localhost:8080/analyze
```

## Validação no LFW (opcional)

`scripts/validate_lfw.py` mede detecção e reconhecimento nos 6000 pares de verificação do LFW. Não faz parte da suíte: baixa cerca de 245 MB para `scripts/.lfw/` (fora do controle de versão) na primeira execução.

```sh
MODELS_DIR=models .venv/bin/python scripts/validate_lfw.py
```

Medição feita na construção do serviço, com os três passes e sem blocos: nenhum par de pessoas diferentes aceito com limiar até 0,35.

## Testes

Os testes baixam imagens públicas de exemplo (repositórios `face_recognition` e `insightface`, fixadas por commit) para `tests/.cache/`, fora do controle de versão. Precisam dos dois arquivos `.onnx` numa pasta apontada por `MODELS_DIR`:

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements-dev.txt
curl -L -o /tmp/buffalo_l.zip https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip
unzip /tmp/buffalo_l.zip det_10g.onnx w600k_r50.onnx -d models
MODELS_DIR=models .venv/bin/python -m pytest tests
```

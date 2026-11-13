# Contribuindo

1. `npm test` roda os testes (Python e Node, offline, dados inventados).
2. Para ver o site localmente com um recorte rápido: `npm run build:sc` e depois `npm run dev`
   (abre em http://localhost:3000; precisa baixar a base da Anatel, ~90 MB).
3. **Nunca edite `public/` nem `MapaDeAntenas.html`**: são gerados. Edite `app/`, `ferramentas/` ou `public_extra/`.
4. Toda regra nova de consolidação precisa de teste em `tests/test_antenas.py`.

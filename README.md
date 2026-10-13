# Rastreador de Frota

Aplicação web para acompanhar os veículos da empresa em tempo real: localização no mapa, velocidade, e envio de avisos que são **lidos em voz alta** no celular do motorista.

- **Gestor** → entra no painel, vê todos os veículos no mapa e envia avisos falados.
- **Motorista** → abre no celular, inicia o turno e o aparelho transmite a localização e lê os avisos em voz alta.

Tudo roda com **login seguro** e **HTTPS** (via Vercel). Os dados ficam no **Supabase** (banco Postgres), com regras de segurança que garantem que cada motorista só vê o que é dele e só o gestor envia avisos.

> **Importante (privacidade / LGPD):** antes de usar com motoristas de verdade, avise-os formalmente por escrito de que o veículo é monitorado durante o expediente e colha a ciência deles. Monitorar localização no horário de trabalho é aceitável com aviso; evite rastrear fora do expediente. Em caso de dúvida, consulte um advogado trabalhista.

---

## O que você vai precisar (tudo tem plano grátis)

1. Uma conta no **[Supabase](https://supabase.com)** (banco de dados).
2. Uma conta no **[GitHub](https://github.com)** (guardar o código).
3. Uma conta no **[Vercel](https://vercel.com)** (publicar o site).

O passo a passo abaixo leva uns 15–20 minutos na primeira vez.

---

## Passo 1 — Criar o banco no Supabase

1. Entre no Supabase e clique em **New project**. Dê um nome (ex.: `frota`), defina uma senha forte para o banco e crie.
2. Espere uns 2 minutos até o projeto ficar pronto.
3. No menu lateral, abra **SQL Editor** → **New query**.
4. Abra o arquivo **`supabase_schema.sql`** deste projeto, copie **todo** o conteúdo, cole na janela e clique em **Run**. Deve aparecer "Success".
5. Ainda no menu lateral, vá em **Project Settings** (ícone de engrenagem) → **API**. Anote dois valores:
   - **Project URL** (algo como `https://abcde.supabase.co`)
   - **anon public** key (uma chave longa)

   Você vai usar os dois no Passo 3.

### Criar os usuários

6. Vá em **Authentication** → **Users** → **Add user** → **Create new user**.
   - Marque a opção de confirmar o e-mail automaticamente (auto-confirm), para não precisar de e-mail de verificação.
   - Crie um usuário para o **gestor** (ex.: `gestor@empresa.com`) e um para cada **motorista**.
7. Transforme o gestor em gestor. Volte no **SQL Editor** e rode (trocando o e-mail):

   ```sql
   update public.perfis set papel = 'gestor'
   where id = (select id from auth.users where email = 'gestor@empresa.com');
   ```

8. (Opcional, recomendado) Dê um nome de veículo a cada motorista:

   ```sql
   update public.perfis set veiculo = 'Caminhão 01 - ABC1D23'
   where id = (select id from auth.users where email = 'motorista@empresa.com');
   ```

---

## Passo 2 — Subir o código no GitHub

1. Crie um repositório novo no GitHub (pode ser privado).
2. Envie os arquivos deste projeto para ele. Se você usa o site do GitHub, pode arrastar a pasta em **Add file → Upload files**. Se usa o terminal:

   ```bash
   git init
   git add .
   git commit -m "Rastreador de frota"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
   git push -u origin main
   ```

> O arquivo `.gitignore` já impede que suas chaves secretas (`.env.local`) vão para o GitHub.

---

## Passo 3 — Publicar na Vercel

1. Entre na Vercel → **Add New → Project** → importe o repositório que você acabou de criar no GitHub.
2. Na tela de configuração, abra **Environment Variables** e adicione as duas:

   | Nome | Valor |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | a **Project URL** do Passo 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a chave **anon public** do Passo 1 |

3. Clique em **Deploy**. Em 1–2 minutos a Vercel te dá um endereço, tipo `https://sua-frota.vercel.app`.

Pronto, está no ar e com HTTPS (obrigatório para o GPS e a voz funcionarem no celular).

---

## Como usar no dia a dia

### Gestor (no computador)
- Acesse o endereço da Vercel, faça login com o usuário gestor.
- Você cai direto no **painel**: mapa com os veículos, lista lateral com velocidade de cada um, e o formulário de **avisos falados**.
- Para avisar um motorista: escolha o motorista, escreva a mensagem e clique em **Enviar aviso**. O celular dele vai tocar um bip e **ler a mensagem em voz alta**.

### Motorista (no celular)
- Acesse o mesmo endereço no navegador do celular (Chrome no Android, Safari no iPhone) e faça login.
- Toque em **Iniciar turno**.
  - O navegador vai **pedir permissão de localização** — toque em **Permitir**.
- Deixe a tela aberta durante o trajeto. A velocidade aparece na tela e a localização é enviada sozinha.
- Quando a central mandar um aviso, o celular lê em voz alta automaticamente.

> **Dica:** peça para o motorista adicionar o site à tela inicial ("Adicionar à tela de início"), fica parecendo um app.

---

## Limitações que você deve conhecer

- **Precisa ficar com a tela aberta.** Navegador não roda bem com o app fechado ou a tela apagada por muito tempo. O app tenta manter a tela acesa, mas se o motorista trocar de app ou bloquear o celular, o envio pode pausar. Para rastreamento 24/7 à prova de tudo, o certo no futuro é um app nativo ou um rastreador dedicado.
- **Som no silencioso.** Se o celular estiver no modo silencioso, a leitura em voz alta pode não sair. Oriente a deixar o volume ligado.
- **Câmera e microfone** foram deixados de fora de propósito nesta versão (navegador exige que a pessoa autorize na hora e há implicações legais fortes). Dá para adicionar depois como videochamada com aceite do motorista.

---

## Mexer no código localmente (opcional)

Se quiser testar na sua máquina antes:

```bash
npm install
cp .env.local.example .env.local   # preencha com suas chaves do Supabase
npm run dev
```

Abra `http://localhost:3000`. (Obs.: GPS e voz só funcionam 100% em HTTPS; em `localhost` o navegador libera para teste.)

---

## Estrutura do projeto

```
rastreador-frota/
├── supabase_schema.sql      ← cole no Supabase para criar o banco
├── app/
│   ├── login/               ← tela de login
│   ├── motorista/           ← tela do motorista (GPS + voz)
│   ├── painel/              ← painel do gestor (mapa + avisos)
│   └── page.tsx             ← redireciona conforme o papel
├── components/Mapa.tsx      ← mapa dos veículos
├── lib/supabaseClient.ts    ← conexão com o Supabase
└── README.md                ← este arquivo
```

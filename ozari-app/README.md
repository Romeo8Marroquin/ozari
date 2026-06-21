# Ozari App

Modern React frontend application for the Ozari platform.

**Status**: ✅ Deployed on Cloudflare Pages (dev environment)

## Features

- **React 19** - Latest React with concurrent features
- **Vite** - Lightning-fast development and build
- **TypeScript** - Type-safe development
- **TanStack Router** - File-based routing with type safety
- **TanStack Query** - Server state management
- **Zustand** - Client state management
- **Tailwind CSS 4** - Utility-first styling
- **Vitest** - Unit testing with coverage
- **GSAP** - Advanced animations
- **React Hook Form** - Form management with validation
- **i18next** - Internationalization support

## Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 10.0.0

## Quick Start

### 1. Install Dependencies

```bash
cd ozari-app
pnpm install
```

### 2. Environment Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Configure environment variables:

```bash
# Backend API URL (leave empty to use Vite proxy in development)
VITE_API_URL=
```

**Development**: Leave `VITE_API_URL` empty to use Vite's proxy configuration.
**Staging/Production**: Set to your Cloud Run backend URL.

Use the API origin only, without the `/api` suffix. The frontend client appends `/api` automatically.
For Cloudflare Pages, configure this value per environment in the Pages dashboard instead of committing real environment files.

### 3. Development

```bash
# Start dev server
pnpm run dev

# Start with network access
pnpm run dev:local
```

Application will be available at `http://localhost:5173`

### 4. Testing

```bash
# Run tests once
pnpm test

# Run tests in watch mode
pnpm run test:watch

# Run tests with UI
pnpm run test:ui

# Generate coverage report
pnpm run test:coverage

# Watch mode with coverage
pnpm run test:local
```

### 5. Production Build

```bash
# Build for production
pnpm run build

# Preview production build
pnpm run preview
```

## Project Structure

```
src/
├── routes/              # File-based routes (TanStack Router)
│   ├── __root.tsx       # Root layout
│   ├── index.tsx        # Landing page (/)
│   ├── sesion.tsx       # Auth layout (/sesion)
│   ├── sesion/          # Auth routes
│   ├── panel.tsx        # Panel layout (/panel)
│   └── panel/           # Panel routes
├── modules/             # Feature modules
│   ├── landing/         # Landing page components
│   ├── sesion/          # Authentication components
│   └── panel/           # Dashboard components
├── components/          # Shared UI components
├── api/                 # API client (Axios + TanStack Query)
├── hooks/               # Custom React hooks
├── contexts/            # React contexts
├── utils/               # Utility functions
├── constants/           # App constants
├── types/               # TypeScript types
├── assets/              # Static assets
├── i18n.ts              # i18n configuration
└── main.tsx             # Application entry point
```

## Routing

The app uses **TanStack Router** with file-based routing. Routes are automatically generated from the `routes/` directory.

### Route Structure

- **`__root.tsx`** - Root layout component
- **`index.tsx`** - Maps to `/`
- **`sesion.tsx`** - Layout route for `/sesion`
- **`sesion/*.tsx`** - Nested routes under `/sesion/*`
- **`panel.tsx`** - Layout route for `/panel` (authenticated)
- **`panel/*.tsx`** - Nested routes under `/panel/*`

### Adding a New Route

1. Create a new file in `src/routes/`:
   ```tsx
   // src/routes/about.tsx
   import { createFileRoute } from '@tanstack/react-router'

   export const Route = createFileRoute('/about')({
     component: About,
   })

   function About() {
     return <div>About Page</div>
   }
   ```

2. The route tree is automatically regenerated in `routeTree.gen.ts`
3. Navigate to `/about` in your browser

## API Integration

API calls are handled using **Axios** and **TanStack Query**.

### API Client

Located in `src/api/client.ts`, the client is configured with:
- **Base URL**:
  - Development: `/api` (proxied by Vite to `http://localhost:3000`)
  - Staging/Production: `${VITE_API_URL}/api` (direct to Cloud Run backend)
- **Authentication**: Automatically injects JWT token from session storage
- **Device Tracking**: Sends `device-uuid` header for session management
- **CSRF**: Sends `x-csrf-token` from the CSRF cookie for state-changing requests
- **Public Endpoints**: Skip authentication when `config.public` is true
- **Request/Response Interceptors**: Error handling and token refresh

### Using TanStack Query

```tsx
import { useQuery } from '@tanstack/react-query'
import { api } from '@api/client'

function MyComponent() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users'),
  })

  // Component logic
}
```

## Styling

The app uses **Tailwind CSS 4** with the Vite plugin for optimal performance.

### Tailwind Configuration

- Configuration in `vite.config.ts`
- Global styles in `src/index.css`
- Utility classes available throughout the app

### Using Styles

```tsx
function Button() {
  return (
    <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
      Click me
    </button>
  )
}
```

## State Management

### Server State (TanStack Query)

For API data, loading states, caching:

```tsx
const { data } = useQuery({
  queryKey: ['key'],
  queryFn: fetchData,
})
```

### Client State (Zustand)

For global UI state:

```tsx
import { create } from 'zustand'

const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}))
```

## Forms

Forms use **React Hook Form** with **Zod** validation:

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

function LoginForm() {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  })

  const onSubmit = (data) => {
    console.log(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('email')} />
      <input {...register('password')} type="password" />
      <button type="submit">Submit</button>
    </form>
  )
}
```

## Path Aliases

The following path aliases are configured:

```typescript
@hooks       → src/hooks
@utils       → src/utils
@functions   → src/utils/functions
@sesion      → src/modules/sesion
@assets      → src/assets
@components  → src/components
@constants   → src/constants
@contexts    → src/contexts
@api         → src/api
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start dev server |
| `pnpm run dev:local` | Start dev server with network access |
| `pnpm run build` | Build for production |
| `pnpm run preview` | Preview production build |
| `pnpm test` | Run tests once |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:ui` | Run tests with UI |
| `pnpm run test:coverage` | Generate coverage report |
| `pnpm run test:local` | Watch mode with coverage |
| `pnpm run lint` | Run ESLint |

## Deployment

### Cloudflare Pages

**Status**: ✅ Deployed and operational

The frontend is deployed on Cloudflare Pages with automatic deployments from the `dev` branch.

**Configuration**:
- **Platform**: Cloudflare Pages
- **Build Command**: `pnpm run build`
- **Build Output Directory**: `dist`
- **Node Version**: 22
- **Auto-Deploy**: Enabled from `dev` branch

**Environment Variables** (configured in Cloudflare Pages):
```bash
VITE_API_URL=<your-cloud-run-backend-url>
```

**Security Configuration**:

The app includes Content Security Policy (CSP) configured in `index.html`:
- Whitelists Cloud Run backend in `connect-src` directive
- Enforces HTTPS for all connections
- Restricts resource loading to trusted sources
- Prevents XSS and injection attacks

**Important**: Update the CSP in `index.html` to match your Cloud Run backend URL:
```html
<meta
  http-equiv="Content-Security-Policy"
  content="
    ...
    connect-src 'self' https://your-cloud-run-backend-url;
    ...
  "
/>
```

**Setup Steps**:
1. Connect repository to Cloudflare Pages
2. Configure build settings:
   - Framework preset: Vite
   - Build command: `pnpm run build`
   - Build output: `dist`
   - Root directory: `ozari-app`
3. Set environment variables (see above)
4. Enable auto-deploy from `dev` branch


## Technologies

- **React** 19.1.0 - UI library
- **TypeScript** 5.8.3 - Type safety
- **Vite** 6.3.5 - Build tool
- **TanStack Router** 1.120.3 - Routing
- **TanStack Query** 5.83.0 - Server state
- **Zustand** 5.0.4 - Client state
- **Tailwind CSS** 4.1.6 - Styling
- **React Hook Form** 7.56.3 - Forms
- **Zod** 3.24.4 - Validation
- **Axios** 1.10.0 - HTTP client
- **GSAP** 3.13.0 - Animations
- **i18next** 25.1.2 - Internationalization
- **Vitest** 3.1.3 - Testing

## Development Guidelines

### Code Style

- Use functional components with hooks
- Prefer named exports over default exports
- Keep components focused and single-responsibility
- Use TypeScript types for all props and state

### File Organization

- Group related components in feature modules
- Keep shared components in `components/`
- Use barrel exports (`index.ts`) for clean imports

### Testing

- Write tests for business logic and utilities
- Test user interactions and component behavior
- Aim for meaningful test coverage, not 100%

## License

Proprietary

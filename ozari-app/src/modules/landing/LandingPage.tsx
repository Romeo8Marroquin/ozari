import { Link } from '@tanstack/react-router';

const LandingPage: React.FC = () => {
  return (
    <div>
      LandingPage <Link to="/sesion/inicio" aria-label="Ir a inicio de sesion">Iniciar sesion</Link>
    </div>
  );
};

export default LandingPage;

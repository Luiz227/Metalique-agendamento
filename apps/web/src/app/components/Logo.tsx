import logoMetalique from '../../imports/logo-metalique.png';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'h-8',
  md: 'h-12',
  lg: 'h-16'
};

export default function Logo({ className = '', size = 'md' }: LogoProps) {
  return (
    <img
      src={logoMetalique}
      alt="Metalique Agenda"
      className={`object-contain ${sizeMap[size]} ${className}`}
    />
  );
}

// 3D tilt card (after Aceternity's 3d-card), rewritten without Tailwind for the arena build.
import {
  type ComponentPropsWithoutRef,
  createContext,
  type ElementType,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

const Hovering = createContext(false);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function CardContainer({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const tilt = (x = 0, y = 0) => {
    if (inner.current) inner.current.style.transform = `rotateY(${x}deg) rotateX(${y}deg)`;
  };
  return (
    <Hovering.Provider value={hovering}>
      <div className={`card3d-container ${className}`}>
        <div
          ref={inner}
          className="card3d-inner"
          onMouseEnter={() => !reducedMotion() && setHovering(true)}
          onMouseMove={(e) => {
            if (reducedMotion() || !inner.current) return;
            const { left, top, width, height } = inner.current.getBoundingClientRect();
            tilt((e.clientX - left - width / 2) / 25, -(e.clientY - top - height / 2) / 25);
          }}
          onMouseLeave={() => {
            setHovering(false);
            tilt();
          }}
        >
          {children}
        </div>
      </div>
    </Hovering.Provider>
  );
}

export function CardBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card3d-body ${className}`}>{children}</div>;
}

type CardItemProps<T extends ElementType> = {
  as?: T;
  translateX?: number;
  translateY?: number;
  translateZ?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
} & ComponentPropsWithoutRef<T>;

export function CardItem<T extends ElementType = 'div'>({
  as,
  children,
  className = '',
  translateX = 0,
  translateY = 0,
  translateZ = 0,
  rotateX = 0,
  rotateY = 0,
  rotateZ = 0,
  ...rest
}: CardItemProps<T>) {
  const Tag: ElementType = as ?? 'div';
  const ref = useRef<HTMLElement>(null);
  const hovering = useContext(Hovering);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.transform = hovering
      ? `translateX(${translateX}px) translateY(${translateY}px) translateZ(${translateZ}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`
      : 'translateX(0px) translateY(0px) translateZ(0px) rotateX(0deg) rotateY(0deg) rotateZ(0deg)';
  }, [hovering, translateX, translateY, translateZ, rotateX, rotateY, rotateZ]);
  return (
    <Tag ref={ref} className={`card3d-item ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

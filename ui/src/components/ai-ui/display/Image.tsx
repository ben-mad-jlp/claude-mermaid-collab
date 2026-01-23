import React from 'react';

export interface ImageProps {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  caption?: string;
  className?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
}

export const Image: React.FC<ImageProps> = ({
  src,
  alt,
  width,
  height,
  caption,
  className = '',
  objectFit = 'contain',
}) => {
  const imgElement = (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      style={{ objectFit }}
      className={`
        max-w-full
        rounded-lg
        ${className}
      `}
    />
  );

  if (caption) {
    return (
      <figure className="flex flex-col gap-2">
        {imgElement}
        <figcaption className="text-sm text-center text-gray-600 dark:text-gray-400">
          {caption}
        </figcaption>
      </figure>
    );
  }

  return imgElement;
};

Image.displayName = 'Image';

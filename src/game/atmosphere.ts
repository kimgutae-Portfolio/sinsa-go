import * as THREE from "three";

export function createSky() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(130, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        zenith: { value: new THREE.Color("#86adba") },
        horizon: { value: new THREE.Color("#e5e4d0") },
      },
      vertexShader: `varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; varying vec3 vDirection;
      float noise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); vec4 v=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1,0),vec2(127.1,311.7)),dot(i+vec2(0,1),vec2(127.1,311.7)),dot(i+vec2(1),vec2(127.1,311.7))))*43758.5453); return mix(mix(v.x,v.y,f.x),mix(v.z,v.w,f.x),f.y); }
      void main() { vec3 d=normalize(vDirection); float y=max(0.0,d.y); vec3 color=mix(horizon,zenith,pow(y,0.6)); vec2 p=d.xz/(y+0.35)*2.3; float cloud=noise(p)*0.65+noise(p*2.1)*0.25+noise(p*4.0)*0.1; color=mix(color,vec3(0.94,0.94,0.86),smoothstep(0.58,0.81,cloud)*smoothstep(0.08,0.35,y)*0.65); gl_FragColor=vec4(color,1.0);
      #include <colorspace_fragment>
      }`,
    }),
  );
}

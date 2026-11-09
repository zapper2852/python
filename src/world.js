import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/** Physics world with a fixed gravity, matching Unity's default -9.81 m/s². */
export function createPhysicsWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  world.solver.iterations = 12;
  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0;
  return world;
}

/**
 * Flat driving surface. A thick static box rather than an infinite plane:
 * cannon's plane shape is not hit reliably by the vehicle's suspension rays.
 */
export function addGround(world) {
  const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(20000, 0.5, 20000)),
  });
  groundBody.position.set(0, -0.5, 0);
  world.addBody(groundBody);
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fc4ee');
  scene.fog = new THREE.Fog('#b7d7ee', 190, 560);

  // Gradient sky dome.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1100, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#2f7fc4') },
        bottom: { value: new THREE.Color('#cfe6f6') },
        offset: { value: 120 },
        exponent: { value: 0.7 },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 bottom;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
          gl_FragColor = vec4(mix(bottom, top, pow(max(h, 0.0), exponent)), 1.0);
        }
      `,
    })
  );
  scene.add(sky);

  // A few flat clouds.
  const cloudMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  });
  const cloudGeo = new THREE.SphereGeometry(1, 12, 8);
  for (let i = 0; i < 14; i += 1) {
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    const angle = (i / 14) * Math.PI * 2 + Math.random();
    const radius = 320 + Math.random() * 420;
    cloud.position.set(
      Math.cos(angle) * radius,
      150 + Math.random() * 90,
      Math.sin(angle) * radius
    );
    cloud.scale.set(40 + Math.random() * 50, 9 + Math.random() * 7, 30 + Math.random() * 30);
    scene.add(cloud);
  }

  scene.add(new THREE.HemisphereLight('#cfe4f7', '#5c6b4f', 1.05));

  const sun = new THREE.DirectionalLight('#fff2dc', 2.6);
  sun.position.set(70, 110, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48;
  sun.shadow.camera.bottom = -48;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.userData.sun = sun;

  return scene;
}

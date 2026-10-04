// Filtre de Kalman à vitesse constante et petite classe de matrices (Mat).
// Portage de kalman_cv.hpp et linalg.hpp de pavois++.

/** Petite matrice de nombres, avec les opérations de base. */
export class Mat {
  readonly rows: number;
  readonly cols: number;
  private readonly d: number[];

  constructor(rows: number, cols: number, fill = 0) {
    this.rows = rows;
    this.cols = cols;
    this.d = new Array(rows * cols).fill(fill);
  }

  static identity(n: number): Mat {
    const m = new Mat(n, n, 0);
    for (let i = 0; i < n; i++) m.put(i, i, 1);
    return m;
  }

  clone(): Mat {
    const m = new Mat(this.rows, this.cols);
    for (let i = 0; i < this.d.length; i++) m.d[i] = this.d[i];
    return m;
  }

  at(r: number, c: number): number {
    return this.d[r * this.cols + c];
  }

  put(r: number, c: number, value: number): void {
    this.d[r * this.cols + c] = value;
  }

  add(o: Mat): Mat {
    const r = new Mat(this.rows, this.cols);
    for (let i = 0; i < this.d.length; i++) r.d[i] = this.d[i] + o.d[i];
    return r;
  }

  sub(o: Mat): Mat {
    const r = new Mat(this.rows, this.cols);
    for (let i = 0; i < this.d.length; i++) r.d[i] = this.d[i] - o.d[i];
    return r;
  }

  mul(o: Mat): Mat {
    const r = new Mat(this.rows, o.cols, 0);
    for (let i = 0; i < this.rows; i++) {
      for (let k = 0; k < this.cols; k++) {
        const a = this.at(i, k);
        if (a === 0) continue;
        for (let j = 0; j < o.cols; j++) {
          r.put(i, j, r.at(i, j) + a * o.at(k, j));
        }
      }
    }
    return r;
  }

  scale(s: number): Mat {
    const r = new Mat(this.rows, this.cols);
    for (let i = 0; i < this.d.length; i++) r.d[i] = this.d[i] * s;
    return r;
  }

  transpose(): Mat {
    const r = new Mat(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) r.put(j, i, this.at(i, j));
    }
    return r;
  }

  // Inverse par pivot de Gauss-Jordan ; renvoie une matrice de zéros de
  // même taille si la matrice n'est pas inversible.
  inverse(): Mat {
    const n = this.rows;
    const a = this.clone();
    const inv = Mat.identity(n);
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(a.at(r, col)) > Math.abs(a.at(piv, col))) piv = r;
      }
      if (Math.abs(a.at(piv, col)) < 1e-15) return new Mat(n, n, 0);
      if (piv !== col) swapRows(a, inv, col, piv, n);
      const d = a.at(col, col);
      for (let k = 0; k < n; k++) {
        a.put(col, k, a.at(col, k) / d);
        inv.put(col, k, inv.at(col, k) / d);
      }
      eliminate(a, inv, col, n);
    }
    return inv;
  }
}

function swapRows(a: Mat, inv: Mat, col: number, piv: number, n: number): void {
  for (let k = 0; k < n; k++) {
    const t0 = a.at(col, k);
    a.put(col, k, a.at(piv, k));
    a.put(piv, k, t0);
    const t1 = inv.at(col, k);
    inv.put(col, k, inv.at(piv, k));
    inv.put(piv, k, t1);
  }
}

function eliminate(a: Mat, inv: Mat, col: number, n: number): void {
  for (let r = 0; r < n; r++) {
    if (r === col) continue;
    const f = a.at(r, col);
    if (f === 0) continue;
    for (let k = 0; k < n; k++) {
      a.put(r, k, a.at(r, k) - f * a.at(col, k));
      inv.put(r, k, inv.at(r, k) - f * inv.at(col, k));
    }
  }
}

/**
 * Filtre de Kalman à vitesse constante. Il garde une estimation de la
 * position et de la vitesse d'une cible, avec leur incertitude.
 */
export class KalmanCV {
  private dim = 0;
  private q = 1;
  private r = 1;
  private inited = false;
  private x = new Mat(0, 0);
  private P = new Mat(0, 0);

  clone(): KalmanCV {
    const k = new KalmanCV();
    k.dim = this.dim;
    k.q = this.q;
    k.r = this.r;
    k.inited = this.inited;
    k.x = this.x.clone();
    k.P = this.P.clone();
    return k;
  }

  /** Démarre le filtre sur une première position. */
  init(
    dim: number,
    p0: number[],
    processNoise: number,
    measNoise: number,
    posCov?: number[],
    velVar = 100,
  ): void {
    this.dim = dim;
    this.q = processNoise;
    this.r = measNoise * measNoise;
    const n = 2 * dim;
    this.x = new Mat(n, 1, 0);
    for (let i = 0; i < dim; i++) this.x.put(i, 0, p0[i]);
    this.P = Mat.identity(n);
    for (let i = 0; i < dim; i++) {
      this.P.put(i, i, measNoise * measNoise);
      this.P.put(dim + i, dim + i, velVar);
    }
    this.inited = true;
    if (posCov && posCov.length === dim * dim) {
      const R = this.measR(posCov);
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) this.P.put(i, j, R.at(i, j));
      }
    }
  }

  initialized(): boolean {
    return this.inited;
  }

  /**
   * Fait avancer l'estimation de dt secondes en supposant une vitesse
   * constante. L'incertitude grandit avec le temps.
   */
  predict(dt: number): void {
    if (!this.inited || dt <= 0) return;
    const n = 2 * this.dim;
    const F = Mat.identity(n);
    for (let i = 0; i < this.dim; i++) F.put(i, this.dim + i, dt);
    const Q = processQ(n, this.dim, this.q, dt);
    this.x = F.mul(this.x);
    this.P = F.mul(this.P).mul(F.transpose()).add(Q);
  }

  // Corrige l'estimation avec une mesure z. measCov est la covariance de la
  // mesure (dim x dim, ligne par ligne) ; sans elle, on utilise le bruit
  // measNoise donné à l'initialisation.
  update(z: number[], measCov?: number[]): void {
    if (!this.inited) return;
    const n = 2 * this.dim;
    const H = measH(this.dim, n);
    const R = this.measR(measCov);
    const zz = col(z, this.dim);
    const y = zz.sub(H.mul(this.x));
    const S = H.mul(this.P).mul(H.transpose()).add(R);
    const K = this.P.mul(H.transpose()).mul(S.inverse());
    this.x = this.x.add(K.mul(y));
    // Forme de Joseph : P reste symétrique et positive même quand le bruit
    // de mesure n'est pas le même dans toutes les directions.
    const IKH = Mat.identity(n).sub(K.mul(H));
    this.P = IKH.mul(this.P)
      .mul(IKH.transpose())
      .add(K.mul(R).mul(K.transpose()));
  }

  // Distance de Mahalanobis au carré entre la mesure z et la position
  // prédite : un écart compté en nombre d'incertitudes, pas en mètres.
  gatingDistance(z: number[], measCov?: number[]): number {
    const n = 2 * this.dim;
    const H = measH(this.dim, n);
    const R = this.measR(measCov);
    const zz = col(z, this.dim);
    const y = zz.sub(H.mul(this.x));
    const S = H.mul(this.P).mul(H.transpose()).add(R);
    const d = y.transpose().mul(S.inverse()).mul(y);
    return d.at(0, 0);
  }

  /** Position estimée. */
  position(): number[] {
    const p = new Array<number>(this.dim);
    for (let i = 0; i < this.dim; i++) p[i] = this.x.at(i, 0);
    return p;
  }

  /** Vitesse estimée, axe par axe. */
  velocity(): number[] {
    const v = new Array<number>(this.dim);
    for (let i = 0; i < this.dim; i++) {
      v[i] = this.x.at(this.dim + i, 0);
    }
    return v;
  }

  /** Vitesse estimée, en norme (m/s). */
  speed(): number {
    let s = 0;
    for (let i = 0; i < this.dim; i++) {
      const v = this.x.at(this.dim + i, 0);
      s += v * v;
    }
    return Math.sqrt(s);
  }

  // Partie « position » de P (dim x dim, ligne par ligne) : l'incertitude
  // sur la position.
  positionCovariance(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.dim; i++) {
      for (let j = 0; j < this.dim; j++) out.push(this.P.at(i, j));
    }
    return out;
  }

  /** Construit la matrice de bruit de la mesure. */
  private measR(measCov?: number[]): Mat {
    if (!measCov || measCov.length !== this.dim * this.dim) {
      return measR(this.dim, this.r);
    }
    const R = new Mat(this.dim, this.dim, 0);
    for (let i = 0; i < this.dim; i++) {
      for (let j = 0; j < this.dim; j++) {
        // On la rend symétrique : une covariance issue d'une inversion
        // numérique ne l'est qu'à peu près.
        const v = 0.5 * (measCov[i * this.dim + j] + measCov[j * this.dim + i]);
        R.put(i, j, v);
      }
    }
    return R;
  }

  /** Incertitude moyenne sur la position, en mètres. */
  positionUncertainty(): number {
    let t = 0;
    for (let i = 0; i < this.dim; i++) t += this.P.at(i, i);
    return Math.sqrt(t / this.dim);
  }
}

function col(z: number[], dim: number): Mat {
  const zz = new Mat(dim, 1, 0);
  for (let i = 0; i < dim; i++) zz.put(i, 0, z[i]);
  return zz;
}

function measH(dim: number, n: number): Mat {
  const H = new Mat(dim, n, 0);
  for (let i = 0; i < dim; i++) H.put(i, i, 1);
  return H;
}

function measR(dim: number, r: number): Mat {
  const R = new Mat(dim, dim, 0);
  for (let i = 0; i < dim; i++) R.put(i, i, r);
  return R;
}

/**
 * Bruit de modèle : de combien l'incertitude augmente pendant dt, parce
 * que la cible peut accélérer.
 */
function processQ(n: number, dim: number, q: number, dt: number): Mat {
  const Q = new Mat(n, n, 0);
  const t2 = dt * dt;
  const t3 = t2 * dt;
  const t4 = t3 * dt;
  for (let i = 0; i < dim; i++) {
    Q.put(i, i, (q * t4) / 4);
    Q.put(i, dim + i, (q * t3) / 2);
    Q.put(dim + i, i, (q * t3) / 2);
    Q.put(dim + i, dim + i, q * t2);
  }
  return Q;
}

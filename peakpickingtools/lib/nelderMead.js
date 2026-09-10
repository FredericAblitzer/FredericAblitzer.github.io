"use strict";

/**
 * Algorithme de Nelder-Mead générique pour minimiser une fonction à n variables
 * (utilisable pour 2 variables en passant un point initial de longueur 2).
 *
 * @param {function(number[]): number} func - Fonction objectif à minimiser.
 * @param {number[]} start - Point initial (taille = nombre de variables).
 * @param {object} [options]
 *   @param {number|number[]} [options.step=1] - Taille du simplex initial (scalaire ou tableau par dimension).
 *   @param {number} [options.alpha=1]   - Coefficient de réflexion.
 *   @param {number} [options.gamma=2]   - Coefficient d'expansion.
 *   @param {number} [options.rho=0.5]   - Coefficient de contraction.
 *   @param {number} [options.sigma=0.5] - Coefficient de réduction (shrink).
 *   @param {number} [options.maxIter=200] - Nombre maximal d'itérations.
 *   @param {number} [options.tol=1e-6]     - Tolérance sur l'écart des valeurs du simplex.
 * @returns {{point:number[], value:number, iterations:number, simplex:Array<{point:number[], value:number}>}}
 */
function nelderMead(func, start, options = {}) {
  if (typeof func !== "function") {
    throw new TypeError("func doit être une fonction");
  }
  if (!Array.isArray(start) || start.length === 0) {
    throw new TypeError("start doit être un tableau non vide");
  }

  const dim = start.length;
  const {
    step = 1,
    alpha = 1,
    gamma = 2,
    rho = 0.5,
    sigma = 0.5,
    maxIter = 200,
    tol = 1e-6
  } = options;

  const simplex = new Array(dim + 1);
  const basePoint = start.slice();
  simplex[0] = { point: basePoint, value: func(basePoint) };

  for (let i = 0; i < dim; i++) {
    const p = start.slice();
    const stepValue = Array.isArray(step) ? step[i] : step;
    p[i] = p[i] + (stepValue || 1);
    simplex[i + 1] = { point: p, value: func(p) };
  }

  let iteration = 0;
  while (iteration < maxIter) {
    iteration++;
    simplex.sort((a, b) => a.value - b.value);

    if (spread(simplex) < tol) {
      break;
    }

    const centroid = computeCentroid(simplex, dim);
    const worst = simplex[dim];

    // Réflexion
    const reflected = reflectPoint(centroid, worst.point, alpha);
    const reflectedValue = func(reflected);

    if (reflectedValue < simplex[0].value) {
      // Expansion
      const expanded = expandPoint(centroid, reflected, gamma);
      const expandedValue = func(expanded);
      simplex[dim] = expandedValue < reflectedValue
        ? { point: expanded, value: expandedValue }
        : { point: reflected, value: reflectedValue };
      continue;
    }

    if (reflectedValue < simplex[dim - 1].value) {
      simplex[dim] = { point: reflected, value: reflectedValue };
      continue;
    }

    // Contraction
    const contracted = contractPoint(
      centroid,
      reflectedValue < worst.value ? reflected : worst.point,
      rho
    );
    const contractedValue = func(contracted);

    if (contractedValue < worst.value) {
      simplex[dim] = { point: contracted, value: contractedValue };
      continue;
    }

    // Réduction du simplex
    for (let i = 1; i < simplex.length; i++) {
      const reducedPoint = shrinkPoint(simplex[0].point, simplex[i].point, sigma);
      simplex[i] = { point: reducedPoint, value: func(reducedPoint) };
    }
  }

  simplex.sort((a, b) => a.value - b.value);
  return {
    point: simplex[0].point.slice(),
    value: simplex[0].value,
    iterations: iteration,
    simplex: simplex.map(({ point, value }) => ({ point: point.slice(), value }))
  };

  function computeCentroid(simplexArr, dimension) {
    const centroid = new Array(dimension).fill(0);
    for (let i = 0; i < dimension; i++) {
      for (let j = 0; j < dimension; j++) {
        centroid[j] += simplexArr[i].point[j];
      }
    }
    for (let j = 0; j < dimension; j++) {
      centroid[j] /= dimension;
    }
    return centroid;
  }

  function reflectPoint(centroid, worstPoint, coeff) {
    return centroid.map((c, i) => c + coeff * (c - worstPoint[i]));
  }

  function expandPoint(centroid, reflectedPoint, coeff) {
    return centroid.map((c, i) => c + coeff * (reflectedPoint[i] - c));
  }

  function contractPoint(centroid, comparePoint, coeff) {
    return centroid.map((c, i) => c + coeff * (comparePoint[i] - c));
  }

  function shrinkPoint(bestPoint, currentPoint, coeff) {
    return currentPoint.map((p, i) => bestPoint[i] + coeff * (p - bestPoint[i]));
  }

  function spread(simplexArr) {
    const m = simplexArr.reduce((acc, s) => acc + s.value, 0) / simplexArr.length;
    let variance = 0;
    for (const s of simplexArr) {
      const diff = s.value - m;
      variance += diff * diff;
    }
    return Math.sqrt(variance / simplexArr.length);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { nelderMead };
}

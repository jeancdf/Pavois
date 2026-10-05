import { Component, computed, input } from '@angular/core';
import {
  DEFAULT_RANGE_M,
  adjacentBaselineM,
  railLayout,
  type RailBenchState,
} from '../../config/rail-bench';

/**
 * Pense-bête : quelle Pi va où sur le rail. L'ordre vient du même calcul que
 * la fusion, donc il reste juste si le banc change.
 */
@Component({
  selector: 'app-rail-order',
  templateUrl: './rail-order.html',
  styleUrl: './rail-order.css',
})
export class RailOrder {
  readonly bench = input<RailBenchState | null>(null);

  readonly slots = computed(() => railLayout(this.bench()));
  readonly gapCm = computed(() => Math.round(adjacentBaselineM(this.bench()?.rigWidthMm) * 100));
  readonly rangeM = computed(() => this.bench()?.rangeM ?? DEFAULT_RANGE_M);
}

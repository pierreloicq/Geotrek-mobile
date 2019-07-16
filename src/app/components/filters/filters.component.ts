import { Component, OnDestroy, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ModalController, NavParams, Platform } from '@ionic/angular';
import { cloneDeep } from 'lodash';
import { BehaviorSubject, combineLatest, Subscription } from 'rxjs';

import { UnSubscribe } from '@app/components/abstract/unsubscribe';
import { Filter, FilterValue, MinimalTreks } from '@app/interfaces/interfaces';
import { FilterTreksService } from '@app/services/filter-treks/filter-treks.service';
import { OfflineTreksService } from '@app/services/offline-treks/offline-treks.service';
import { OnlineTreksService } from '@app/services/online-treks/online-treks.service';
import { SettingsService } from '@app/services/settings/settings.service';

@Component({
  selector: 'app-filters',
  templateUrl: './filters.component.html',
  styleUrls: ['./filters.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiltersComponent extends UnSubscribe implements OnInit, OnDestroy {
  public temporaryFilters$ = new BehaviorSubject<Filter[]>([]);
  public nbTemporaryFiltersTreks = 0;
  public isOnline: boolean;
  public commonSrc: string;
  public filters: any[];
  private filtersSubscription: Subscription;

  constructor(
    private modalCtrl: ModalController,
    public settings: SettingsService,
    private onlineTreks: OnlineTreksService,
    private offlineTreks: OfflineTreksService,
    private navParams: NavParams,
    private platform: Platform,
    private ref: ChangeDetectorRef,
  ) {
    super();
  }

  ngOnInit(): void {
    super.ngOnInit();
  }

  ionViewDidEnter() {
    this.isOnline = this.navParams.get('isOnline');
    const treks$ = this.isOnline ? this.onlineTreks.treks$ : this.offlineTreks.treks$;
    this.commonSrc = this.isOnline ? this.onlineTreks.getCommonImgSrc() : this.offlineTreks.getCommonImgSrc();

    this.filtersSubscription = this.settings.filters$.subscribe(filters => {
      this.filters = filters || [];
      this.temporaryFilters$.next(filters || []);
    });

    this.subscriptions$$.push(
      this.platform.backButton.subscribeWithPriority(99999, () => {
        this.close();
      }),

      combineLatest(treks$, this.temporaryFilters$).subscribe(
        ([treks, temporaryFilters]: [MinimalTreks | null, Filter[]]) => {
          if (!!treks) {
            this.nbTemporaryFiltersTreks = FilterTreksService.filter(treks, temporaryFilters).length;
          } else {
            this.nbTemporaryFiltersTreks = 0;
          }

          this.ref.markForCheck();
        },
      ),
    );
  }

  public handleFiltersState(checkState: boolean, filter: Filter, value: FilterValue): void {
    const temporaryFilters = cloneDeep(this.temporaryFilters$.getValue());
    const temporaryFilter = temporaryFilters.find(tempFilter => tempFilter.id === filter.id) as Filter;
    const filterValue = temporaryFilter.values.find(tempValue => tempValue.id === value.id) as FilterValue;
    filterValue.checked = checkState;
    this.temporaryFilters$.next(temporaryFilters);
  }

  public applyFilters(): void {
    this.unsubscribeFilters();
    this.settings.saveFiltersState(this.temporaryFilters$.getValue());
    this.modalCtrl.dismiss(true);
  }

  public eraseFilters(): void {
    const temporaryFilters = cloneDeep(this.temporaryFilters$.getValue());
    temporaryFilters.forEach(filter => {
      filter.values.forEach(value => (value.checked = false));
    });
    this.filters = temporaryFilters;
    this.temporaryFilters$.next(temporaryFilters);
  }

  public close(): void {
    this.modalCtrl.dismiss();
  }

  public trackFilters(index: number, element: Filter): string | null {
    return element ? element.id : null;
  }

  public unsubscribeFilters(): void {
    if (this.filtersSubscription) {
      this.filtersSubscription.unsubscribe();
    }
  }

  ngOnDestroy(): void {
    super.ngOnDestroy();
    this.unsubscribeFilters();
  }
}

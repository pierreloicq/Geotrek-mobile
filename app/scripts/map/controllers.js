'use strict';

var geotrekMap = angular.module('geotrekMap');
var map;

geotrekMap.controller('MapController',
    ['$rootScope', '$state', '$scope', 'logging', '$window', 'filterFilter', 'settings', 'geolocationFactory', 'treksFactory', 'iconsService', 'treks', 'utils', 'leafletService', 'mapParameters', 'mapFactory', 'poisFactory', 'notificationFactory', 'userSettingsService',
    function ($rootScope, $state, $scope, logging, $window, filterFilter, settings, geolocationFactory, treksFactory, iconsService, treks, utils, leafletService, mapParameters, mapFactory, poisFactory, notificationFactory, userSettingsService) {
    $rootScope.statename = $state.current.name;

    // Initializing leaflet map
    map = L.map('map', mapParameters);
    map.options.maxZoom = settings.leaflet.GLOBAL_MAP_DL_TILES_ZOOM;
    var userPosition;
    var treks = new L.MarkerClusterGroup({
        showCoverageOnHover: false,
        spiderfyDistanceMultiplier: 2,
        maxClusterRadius: 60,
        iconCreateFunction: function(cluster) {
            return iconsService.getClusterIcon(cluster);
        }
    });
    $scope.treks = treks;
    // Add treks geojson to the map
    function showTreks(updateBounds) {
        // Remove all markers so the displayed markers can fit the search results
        treks.clearLayers();

        $scope.leafletService = leafletService;
        angular.forEach(filterFilter($rootScope.filteredTreks, $scope.activeFilters.search), function(trek) {
            var trekDeparture = leafletService.createClusterMarkerFromTrek(trek);
            trekDeparture.on({
                click: function(e) {
                    $state.go("home.map.detail", { trekId: trek.id });
                }
            });
            treks.addLayer(trekDeparture);
        });

        map.addLayer(treks);

        if ((updateBounds == undefined) || (updateBounds == true)) {
            if ($rootScope.statename === 'home.map') {
                // With this call, map will always cover all geojson data area
                map.fitBounds(treks.getBounds());
            }
        }
    }

    // Show the scale and attribution controls
    leafletService.setScale(map);
    leafletService.setAttribution(map);
    showTreks();

    // Adding user current position
    geolocationFactory.getLatLngPosition()
        .then(function(result) {
            userPosition = L.marker(result, {icon: leafletService.getPositionMarker()}).addTo(map);
        }, function(error) {
            logging.warn(error);
        });

    $scope.$on('watchPosition', function(scope, position) {
        if (position.lat && position.lng) {
            var alertOnPois;
            userSettingsService.getUserSettings().then(function(userSettings) {
                alertOnPois = userSettings.alertOnPois;
                if (alertOnPois) {
                    poisFactory.getAllPois().then(function(pois) {
                        var nearbyPois = mapFactory.getNearbyPois();
                        angular.forEach(pois, function(poi) {
                            var poiDistanceFromUser = utils.getDistanceFromLatLonInKm(position.lat, position.lng, poi.geometry.coordinates[1], poi.geometry.coordinates[0]).toFixed(2);
                            if (poiDistanceFromUser < settings.device.POI_ALERT_RADIUS) {
                                if (!nearbyPois[poi.id]) {
                                    var msg = poi.properties.name + ' (' + poiDistanceFromUser * 1000 + 'm)';
                                    notificationFactory.notify(msg, poi.properties.name);
                                    mapFactory.addNearbyPoi(poi.id);
                                }
                            } else {
                                mapFactory.removeNearbyPoi(poi.id);
                            }
                        });
                    });
                }
            });

            userPosition.setLatLng(position);
        }
    });

    // README: watchPosition has a weird issue : if we get user CurrentPosition while watch is activated
    // we get no callback for geolocation browser service
    // This callback is used to reactivate watching after getLatLngPosition call, as this call desactivate
    // watch to avoid that issue
    var watchCallback = function() {

        var watchOptions = {
            enableHighAccuracy: true
        };
        // TODO: this watch must depend on user watch setting
        $rootScope.watchID = geolocationFactory.watchPosition($scope, watchOptions);
    };

    // Beginning geolocation watching
    watchCallback();

    // Center map on user position
    function centerMapUser() {

        // We give watchCallback on this call to reactivate watching after geolocation call
        geolocationFactory.getLatLngPosition({}, watchCallback)
        .then(function(result) {
            map.setView(result);
            userPosition.setLatLng(result);
        })
        .catch(function(error) {
            logging.warn(error);
        });
    }

    $scope.centerMapUser = centerMapUser;

    $scope.$on('OnFilter', function() {
        var updateBounds = false;
        // We don't want to adapt map bounds on filter results
        showTreks(updateBounds);
    });

    $rootScope.$on('$stateChangeStart', function (event, toState) {
        if (toState.name === 'home.map') {
            map.options.maxZoom = settings.leaflet.GLOBAL_MAP_DL_TILES_ZOOM;
        }

        if (toState.name === 'home.map.trek') {
            map.options.maxZoom = settings.leaflet.GLOBAL_MAP_DEFAULT_MAX_ZOOM;
        }
    });

}])
.controller('MapControllerDetail', ['$rootScope', '$state', '$scope', '$stateParams', '$q', '$window', 'treksFactory', 'poisFactory', 'touristicsFactory', 'leafletService', 'trek', 'utils', 'settings',
            function ($rootScope, $state, $scope, $stateParams, $q, $window, treksFactory, poisFactory, touristicsFactory, leafletService, trek, utils, settings) {

    $scope.currentTrek = $stateParams.trekId;

    // Draw a polyline to highlight the selected trek
    var currentHighlight = L.geoJson(trek, {style: {'color': settings.leaflet.TREK_COLOR, 'weight': 9, 'opacity': settings.leaflet.HIGHLIGHT_DETAIL_LINEAR ? 1 : 0.8}})
        .addTo(map)
        .setText('>         ', {
            repeat:true,
            offset: 4
        });

    var markersPromises = [];
    var pois;
    var touristics;

    if (settings.leaflet.HIGHLIGHT_DETAIL_LINEAR) {
        var overHighlight = L.geoJson(trek, {style: {'color': settings.leaflet.HIGHLIGHT_COLOR, 'weight': 15, 'opacity': 0.8}})
            .addTo(map)
            .bringToBack();
    }

    map.options.maxZoom = settings.leaflet.GLOBAL_MAP_DEFAULT_MAX_ZOOM;
    // Remove the treks cluster on detail view
    map.removeLayer($scope.$parent.treks);

    $scope.markersLayers = {
        poisMarkers: {
            layer: L.featureGroup().addTo(map),
            visible: true
        },
        touristicMarkers: {
            layer: L.featureGroup().addTo(map),
            visible: true
        },
        treksMarkers: {
            layer: L.featureGroup().addTo(map),
            visible: true
        }
    };

    function poiModal(feature) {
        var modalScope = {
            objectToDisplay: feature
        };
        utils.createModal('views/map_trek_detail.html', modalScope);
    }

    markersPromises.push(
        poisFactory.getPoisFromTrek(trek.id)
            .then(
                function(poisData) {
                    pois = poisData;
                }
            )
    );

    markersPromises.push(
        touristicsFactory.getAllTouristicsContentsFromATrek(trek.id)
            .then(
                function (touristicsData) {
                    touristics = touristicsData;
                }
            )
    );

    $q.all(markersPromises)
        .then(
            function () {
                var markersData = {
                    pois: pois,
                    touristics: touristics
                };

                leafletService.createMarkersFromTrek(trek, markersData)
                    .then(
                        function (markers) {

                            angular.forEach(markers, function(marker) {
                                if (marker.options.markerType === 'poi' || marker.options.markerType === 'information') {
                                    marker.on('click', function(e) {poiModal(e.target.options)});
                                    $scope.markersLayers.poisMarkers.layer.addLayer(marker);
                                } else if (marker.options.markerType === 'touristic') {
                                    marker.on('click', function(e) {poiModal(e.target.options)});
                                    $scope.markersLayers.touristicMarkers.layer.addLayer(marker);
                                } else {
                                    $scope.markersLayers.treksMarkers.layer.addLayer(marker);
                                }
                            });
                        }
                    );
            }
        );

    // Reinitialize focus and markers of a trek on state-change
    $rootScope.$on('$stateChangeStart', function() {
        if (map.hasLayer(currentHighlight)) {
            map.removeLayer(currentHighlight);
        }
        if (map.hasLayer(overHighlight)) {
            map.removeLayer(overHighlight);
        }
        angular.forEach($scope.markersLayers, function (markerLayer) {
            if (map.hasLayer(markerLayer.layer)) {
                map.removeLayer(markerLayer.layer);
            }
        });
        if ($scope.$parent) {
            map.addLayer($scope.$parent.treks);
        }
        map.setZoom(10);
    });

    function centerMapTrek() {
        map.fitBounds(currentHighlight);
    }

    function toggleMarkersMenu() {
        if ($scope.markersMenuIsOpened) {
            closeMarkersMenu();
        } else {
            openMarkersMenu();
        }
    }

    function openMarkersMenu() {
        $scope.markersMenuIsOpened = true;
    }

    function closeMarkersMenu() {
        $scope.markersMenuIsOpened = false;
    }

    function toggleMarkerLayer(layerName) {
        var markerLayer = $scope.markersLayers[layerName];
        if (markerLayer) {
            markerLayer.visible = !markerLayer.visible;
            if (!markerLayer.visible && map.hasLayer(markerLayer.layer)) {
                map.removeLayer(markerLayer.layer);
            }
            if (markerLayer.visible && !map.hasLayer(markerLayer.layer)) {
                map.addLayer(markerLayer.layer);
            }
        }
    }

    $scope.toggleMarkersMenu = toggleMarkersMenu;
    $scope.openMarkersMenu = openMarkersMenu;
    $scope.closeMarkersMenu = closeMarkersMenu;
    $scope.toggleMarkerLayer = toggleMarkerLayer;
    $scope.centerMapTrek = centerMapTrek;

    centerMapTrek();
    toggleMarkerLayer('touristicMarkers');

}]);

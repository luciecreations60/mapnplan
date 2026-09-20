import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../hooks/useI18n.js';
import { formatLocalizedDate } from '../../utils/date.js';
import { createId } from '../../utils/id.js';
import { estimateRouteSegment } from '../../utils/routeOptimization.js';
import { DEFAULT_WEAR_COST_PER_KM, estimatePersonalVehicleCost, getSuggestedConsumption } from '../../utils/transportCost.js';
import { ACTIVITY_TYPES, getCategoryLabel } from '../../utils/tripWorkspace.js';
import {
  buildVisibleItineraryDays,
  combineDuration,
  formatDuration,
  getLastUsedItineraryDate,
  getSeriesRootActivity,
  reservationTypeForActivity,
  splitDuration,
  TRANSPORT_MODES,
  upsertActivityAcrossDates,
  upsertActivityInItinerary,
  upsertItineraryDayTitle,
} from '../../utils/itinerary.js';
import { appendActivityEntry, createActivityEntry, getCurrentActorName } from '../../utils/collaboration.js';
import { DiscussionThread } from '../collaboration/DiscussionThread.jsx';
import { Badge } from '../common/Badge.jsx';
import { Button } from '../common/Button.jsx';
import { Card } from '../common/Card.jsx';
import { Icon } from '../common/Icon.jsx';
import { LocationAutocomplete } from '../common/LocationAutocomplete.jsx';

const EMPTY_FORM = Object.freeze({
  date: '', endDate: '', time: '09:00', endTime: '10:00', type: 'map', title: '', location: '', latitude: '', longitude: '',
  departureLocation: '', departureLatitude: '', departureLongitude: '', transportMode: 'driving',
  durationHours: 1, durationRemainderMinutes: 0, estimatedCost: 0, notes: '', titleAutofilled: false,
  routeDistanceKm: '', vehicleType: 'compact', fuelType: 'petrol', consumptionLPer100Km: getSuggestedConsumption('compact', 'petrol'), fuelPricePerLiter: '', tolls: '',
  includeWear: false, wearCostPerKm: DEFAULT_WEAR_COST_PER_KM,
});

export function ItineraryPanel({ trip, onUpdate, onOpenReservation = null, onOpenBooking = null, createRequest = null }) {
  const { locale, t } = useI18n();
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, date: getLastUsedItineraryDate(trip), endDate: getLastUsedItineraryDate(trip) }));
  const [isFormOpen, setFormOpen] = useState(false);
  const [inlineCreateDate, setInlineCreateDate] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [editingDayId, setEditingDayId] = useState(null);
  const [dayTitleDraft, setDayTitleDraft] = useState('');
  const [showTransportCost, setShowTransportCost] = useState(false);
  const [focusActivityId, setFocusActivityId] = useState(null);
  const formAnchorRef = useRef(null);
  const handledCreateRequestRef = useRef(null);
  const itinerary = useMemo(() => buildVisibleItineraryDays(trip), [trip]);

  useEffect(() => {
    if (!createRequest?.id || handledCreateRequestRef.current === createRequest.id) return;
    handledCreateRequestRef.current = createRequest.id;
    openCreateForm(createRequest.date || getLastUsedItineraryDate(trip), 'day');
  }, [createRequest]);

  useEffect(() => {
    if (!focusActivityId || isFormOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const block = document.getElementById(`itinerary-activity-${focusActivityId}`);
      block?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      block?.focus({ preventScroll: true });
      setFocusActivityId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusActivityId, isFormOpen, itinerary]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => {
      const patch = { [name]: value, ...(name === 'title' ? { titleAutofilled: false } : {}) };
      if (name === 'date' && current.type === 'hotel' && (!current.endDate || current.endDate < value)) patch.endDate = value;
      if (name === 'type' && value === 'hotel' && (!current.endDate || current.endDate < current.date)) patch.endDate = current.date;
      if (name === 'vehicleType' || name === 'fuelType') {
        const vehicleType = name === 'vehicleType' ? value : current.vehicleType;
        const fuelType = name === 'fuelType' ? value : current.fuelType;
        patch.consumptionLPer100Km = getSuggestedConsumption(vehicleType, fuelType);
      }
      if (current.type === 'car' && ['time', 'durationHours', 'durationRemainderMinutes'].includes(name)) {
        const nextTime = name === 'time' ? value : current.time;
        const nextHours = name === 'durationHours' ? value : current.durationHours;
        const nextMinutes = name === 'durationRemainderMinutes' ? value : current.durationRemainderMinutes;
        const durationMinutes = combineDuration(nextHours, nextMinutes);
        if (durationMinutes > 0) patch.endTime = addMinutesToDateTime(current.date, nextTime, durationMinutes).time;
      }
      return { ...current, ...patch };
    });
  }

  function scrollToCreateForm() {
    window.requestAnimationFrame(() => formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function openCreateForm(date = getLastUsedItineraryDate(trip), placement = 'top') {
    const selectedDate = date || trip.startDate || '';
    setEditingActivity(null);
    setInlineCreateDate(placement === 'day' ? selectedDate : null);
    setForm({ ...EMPTY_FORM, date: selectedDate, endDate: selectedDate });
    setShowTransportCost(false);
    setFormOpen(true);
    if (placement !== 'day') scrollToCreateForm();
  }

  function openEditForm(day, activity) {
    const rootActivity = getSeriesRootActivity(trip.itinerary, activity);
    const duration = splitDuration(rootActivity.durationMinutes || activity.durationMinutes || 0);
    setInlineCreateDate(null);
    setEditingActivity({ dayId: day.id, activityId: activity.id });
    setForm({
      date: activity.stayStartDate || day.date,
      endDate: activity.stayEndDate || day.date,
      time: rootActivity.checkInTime || rootActivity.time || activity.time || '',
      endTime: rootActivity.type === 'hotel'
        ? (rootActivity.checkOutTime || activity.checkOutTime || '10:00')
        : (rootActivity.endTime || activity.endTime || ''),
      type: activity.type || 'map',
      title: activity.title || '',
      location: activity.location || '',
      latitude: activity.latitude ?? '',
      longitude: activity.longitude ?? '',
      departureLocation: activity.departureLocation || '',
      departureLatitude: activity.departureLatitude ?? '',
      departureLongitude: activity.departureLongitude ?? '',
      transportMode: activity.transportMode || 'driving',
      durationHours: duration.hours,
      durationRemainderMinutes: duration.minutes,
      estimatedCost: rootActivity.estimatedCost || 0,
      notes: activity.notes || '',
      titleAutofilled: isAutofilledActivityTitle(rootActivity),
      routeDistanceKm: rootActivity.routeDistanceKm || '',
      vehicleType: rootActivity.vehicleType || 'compact',
      fuelType: rootActivity.fuelType || 'petrol',
      consumptionLPer100Km: rootActivity.consumptionLPer100Km || getSuggestedConsumption(rootActivity.vehicleType || 'compact', rootActivity.fuelType || 'petrol'),
      fuelPricePerLiter: rootActivity.fuelPricePerLiter || '',
      tolls: rootActivity.tolls || '',
      includeWear: Boolean(rootActivity.includeWear),
      wearCostPerKm: rootActivity.wearCostPerKm || DEFAULT_WEAR_COST_PER_KM,
    });
    setShowTransportCost(false);
    setFormOpen(true);
  }

  function selectActivityPlace(place, kind = 'arrival') {
    if (!place) return;
    setForm((current) => {
      if (kind === 'departure') {
        const suggestedTitle = current.location && (current.titleAutofilled || !current.title.trim())
          ? `${place.name || place.primaryLabel} → ${deriveTitleFromLocation(current.location)}`
          : current.title;
        return {
          ...current,
          departureLocation: place.label,
          departureLatitude: place.latitude,
          departureLongitude: place.longitude,
          title: suggestedTitle,
          titleAutofilled: suggestedTitle !== current.title || current.titleAutofilled,
        };
      }

      const arrivalLabel = place.name || place.primaryLabel || place.label;
      const suggestedTitle = current.type === 'car' && current.departureLocation
        ? `${deriveTitleFromLocation(current.departureLocation)} → ${arrivalLabel}`
        : arrivalLabel;
      const shouldAutofill = !current.title.trim() || current.titleAutofilled;
      return {
        ...current,
        location: place.label,
        latitude: place.latitude,
        longitude: place.longitude,
        title: shouldAutofill ? suggestedTitle : current.title,
        titleAutofilled: shouldAutofill,
      };
    });
  }

  function updateLocationText(value, kind = 'arrival') {
    setForm((current) => {
      const shouldAutofill = current.titleAutofilled || !current.title.trim();
      if (kind === 'departure') {
        const departureTitle = deriveTitleFromLocation(value);
        const arrivalTitle = deriveTitleFromLocation(current.location);
        return {
          ...current,
          departureLocation: value,
          departureLatitude: '',
          departureLongitude: '',
          title: shouldAutofill && departureTitle && arrivalTitle ? `${departureTitle} → ${arrivalTitle}` : current.title,
          titleAutofilled: shouldAutofill,
        };
      }

      const arrivalTitle = deriveTitleFromLocation(value);
      const departureTitle = deriveTitleFromLocation(current.departureLocation);
      const suggestedTitle = current.type === 'car' && departureTitle
        ? `${departureTitle} → ${arrivalTitle}`
        : arrivalTitle;
      return {
        ...current,
        location: value,
        latitude: '',
        longitude: '',
        title: shouldAutofill && suggestedTitle ? suggestedTitle : current.title,
        titleAutofilled: shouldAutofill,
      };
    });
  }

  function closeForm() {
    setShowTransportCost(false);
    setFormOpen(false);
    setInlineCreateDate(null);
    setEditingActivity(null);
  }

  function calculateTransportDuration() {
    const from = { id: 'departure', latitude: Number(form.departureLatitude), longitude: Number(form.departureLongitude) };
    const to = { id: 'arrival', latitude: Number(form.latitude), longitude: Number(form.longitude) };
    if (![form.departureLatitude, form.departureLongitude, form.latitude, form.longitude].every((value) => value !== '')) return;
    if (![from.latitude, from.longitude, to.latitude, to.longitude].every(Number.isFinite)) return;
    const estimate = estimateRouteSegment(from, to, form.transportMode);
    const duration = splitDuration(estimate.durationMinutes);
    const arrival = addMinutesToDateTime(form.date, form.time, estimate.durationMinutes);
    setForm((current) => ({
      ...current,
      durationHours: duration.hours,
      durationRemainderMinutes: duration.minutes,
      routeDistanceKm: Math.round(estimate.distanceKm * 10) / 10,
      endTime: arrival.time,
    }));
  }

  function calculateTransportCost() {
    const from = { id: 'departure', latitude: Number(form.departureLatitude), longitude: Number(form.departureLongitude) };
    const to = { id: 'arrival', latitude: Number(form.latitude), longitude: Number(form.longitude) };
    let distanceKm = Math.max(0, Number(form.routeDistanceKm) || 0);
    if (!distanceKm && [from.latitude, from.longitude, to.latitude, to.longitude].every(Number.isFinite)) {
      distanceKm = estimateRouteSegment(from, to, 'driving').distanceKm;
    }
    const estimate = estimatePersonalVehicleCost({
      distanceKm,
      consumptionLPer100Km: form.consumptionLPer100Km,
      fuelPricePerLiter: form.fuelPricePerLiter,
      tolls: form.tolls,
      wearCostPerKm: form.wearCostPerKm,
      includeWear: form.includeWear,
    });
    if (estimate.distanceKm <= 0 || Number(form.fuelPricePerLiter) <= 0) return;
    setForm((current) => ({ ...current, routeDistanceKm: estimate.distanceKm, estimatedCost: estimate.total }));
  }

  function persistActivity({ openBooking = false } = {}) {
    const resolvedTitle = form.title.trim() || deriveTitleFromLocation(form.location) || t('itinerary.defaultActivityTitle');
    if (!form.date || !resolvedTitle) return false;
    const previousActivity = editingActivity
      ? trip.itinerary.flatMap((day) => day.items).find((item) => item.id === editingActivity.activityId)
      : null;
    const rootPreviousActivity = previousActivity ? getSeriesRootActivity(trip.itinerary, previousActivity) : null;
    const isTransport = form.type === 'car';
    const activity = {
      id: editingActivity?.activityId || createId('activity'),
      time: form.time,
      endTime: isTransport ? form.endTime : '',
      checkInTime: form.type === 'hotel' ? form.time : '',
      checkOutTime: form.type === 'hotel' ? form.endTime : '',
      type: form.type,
      title: resolvedTitle,
      location: form.location.trim(),
      latitude: form.latitude === '' ? null : Number(form.latitude),
      longitude: form.longitude === '' ? null : Number(form.longitude),
      departureLocation: isTransport ? form.departureLocation.trim() : '',
      departureLatitude: isTransport && form.departureLatitude !== '' ? Number(form.departureLatitude) : null,
      departureLongitude: isTransport && form.departureLongitude !== '' ? Number(form.departureLongitude) : null,
      transportMode: isTransport ? form.transportMode : '',
      durationMinutes: form.type === 'hotel' ? 0 : combineDuration(form.durationHours, form.durationRemainderMinutes),
      estimatedCost: Math.max(0, Number(form.estimatedCost) || 0),
      routeDistanceKm: isTransport ? Math.max(0, Number(form.routeDistanceKm) || 0) : 0,
      vehicleType: isTransport ? form.vehicleType : '',
      fuelType: isTransport ? form.fuelType : '',
      consumptionLPer100Km: isTransport ? Math.max(0, Number(form.consumptionLPer100Km) || 0) : 0,
      fuelPricePerLiter: isTransport ? Math.max(0, Number(form.fuelPricePerLiter) || 0) : 0,
      tolls: isTransport ? Math.max(0, Number(form.tolls) || 0) : 0,
      includeWear: isTransport ? Boolean(form.includeWear) : false,
      wearCostPerKm: isTransport ? Math.max(0, Number(form.wearCostPerKm) || 0) : 0,
      notes: form.notes.trim(),
      reminderMinutes: rootPreviousActivity?.reminderMinutes ?? null,
      externalCalendarUid: rootPreviousActivity?.externalCalendarUid || '',
      completedAt: rootPreviousActivity?.completedAt || null,
      comments: previousActivity?.comments || [],
      linkedReservationId: rootPreviousActivity?.linkedReservationId || previousActivity?.linkedReservationId || null,
      seriesId: previousActivity?.seriesId || null,
    };

    const endDate = form.type === 'hotel' && form.endDate && form.endDate >= form.date ? form.endDate : form.date;
    const nextItinerary = form.type === 'hotel'
      ? upsertActivityAcrossDates(trip.itinerary, form.date, endDate, activity, editingActivity)
      : upsertActivityInItinerary(trip.itinerary, form.date, activity, editingActivity);
    onUpdate({ itinerary: nextItinerary });
    const savedActivity = nextItinerary
      .find((day) => day.date === form.date)?.items
      ?.filter((item) => item.type === activity.type && item.title === activity.title && item.location === activity.location)
      ?.at(-1) || activity;

    setFocusActivityId(savedActivity.id);

    if (openBooking) {
      onOpenBooking?.({
        source: 'itinerary',
        activityType: form.type,
        transportMode: form.transportMode,
        title: resolvedTitle,
        location: form.location.trim(),
        arrivalLocation: form.location.trim(),
        departureLocation: form.departureLocation.trim(),
        startDate: form.date,
        endDate,
        travelers: trip.travelers,
        currency: trip.currency,
        sourceActivityId: savedActivity.id,
      });
    }
    closeForm();
    return true;
  }

  function submitActivity(event) {
    event.preventDefault();
    persistActivity();
  }

  function saveAndCompare() {
    persistActivity({ openBooking: true });
  }

  function removeActivity(dayId, activity) {
    const confirmationKey = activity.seriesId ? 'itinerary.deleteStaySeriesConfirm' : 'itinerary.deleteConfirm';
    if (!window.confirm(t(confirmationKey, { name: activity.title }))) return;

    onUpdate({
      itinerary: activity.seriesId
        ? trip.itinerary.map((day) => ({
            ...day,
            items: day.items.filter((item) => item.seriesId !== activity.seriesId),
            routePlan: null,
          }))
        : trip.itinerary.map((day) => day.id === dayId
            ? { ...day, items: day.items.filter((item) => item.id !== activity.id), routePlan: null }
            : day),
    });
  }

  function moveActivity(dayId, activityId, direction) {
    const nextItinerary = trip.itinerary.map((day) => {
      if (day.id !== dayId) return day;
      const items = [...day.items];
      const index = items.findIndex((item) => item.id === activityId);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= items.length) return day;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...day, items, routePlan: null };
    });
    onUpdate({ itinerary: nextItinerary });
  }

  function createReservationFromActivity(day, activity) {
    const reservationType = reservationTypeForActivity(activity.type);
    if (!reservationType) return;
    const sourceActivity = getSeriesRootActivity(trip.itinerary, activity);
    const existing = trip.reservations.find((reservation) => (
      reservation.sourceActivityId === sourceActivity.id
      || (sourceActivity.seriesId && reservation.sourceActivitySeriesId === sourceActivity.seriesId)
      || reservation.id === activity.linkedReservationId
    ));
    if (existing) {
      onOpenReservation?.(existing.id);
      return;
    }

    const reservationId = createId('reservation');
    const durationMinutes = Math.max(0, Number(sourceActivity.durationMinutes) || 0);
    const startDate = sourceActivity.stayStartDate || day.date;
    const end = sourceActivity.type === 'hotel'
      ? { date: sourceActivity.stayEndDate || startDate, time: '' }
      : addMinutesToDateTime(day.date, sourceActivity.time, durationMinutes);
    const reservation = {
      id: reservationId,
      type: reservationType,
      title: sourceActivity.title,
      provider: '', confirmationNumber: '',
      startDate, startTime: sourceActivity.type === 'hotel' ? (sourceActivity.checkInTime || sourceActivity.time || '') : (sourceActivity.time || ''),
      endDate: end.date, endTime: sourceActivity.type === 'hotel' ? (sourceActivity.checkOutTime || '') : end.time,
      location: sourceActivity.location || sourceActivity.departureLocation || '',
      status: 'pending', amount: Math.max(0, Number(sourceActivity.estimatedCost) || 0), url: '',
      latitude: sourceActivity.latitude ?? null, longitude: sourceActivity.longitude ?? null,
      notes: sourceActivity.notes || '', reminderMinutes: null, externalCalendarUid: '', comments: [],
      sourceActivityId: sourceActivity.id,
      sourceActivitySeriesId: sourceActivity.seriesId || null,
      createdAt: new Date().toISOString(),
    };
    onUpdate({
      reservations: [...trip.reservations, reservation],
      itinerary: trip.itinerary.map((storedDay) => ({
        ...storedDay,
        items: storedDay.items.map((item) => (
          item.id === sourceActivity.id || (sourceActivity.seriesId && item.seriesId === sourceActivity.seriesId)
            ? { ...item, linkedReservationId: reservationId }
            : item
        )),
      })),
    });
  }

  function addActivityComment(dayId, activity, message) {
    const actorName = getCurrentActorName(trip);
    const comment = { id: createId('comment'), authorName: actorName, message, createdAt: new Date().toISOString() };
    const nextItinerary = trip.itinerary.map((day) => day.id === dayId
      ? { ...day, items: day.items.map((item) => item.id === activity.id ? { ...item, comments: [...item.comments, comment] } : item) }
      : day);
    const entry = createActivityEntry({ action: 'commentAdded', actorName, entityType: 'activity', entityId: activity.id, targetTitle: activity.title });
    onUpdate({ itinerary: nextItinerary, collaboration: appendActivityEntry(trip.collaboration, entry) });
  }

  function removeActivityComment(dayId, activityId, commentId) {
    const nextItinerary = trip.itinerary.map((day) => day.id === dayId
      ? { ...day, items: day.items.map((item) => item.id === activityId ? { ...item, comments: item.comments.filter((comment) => comment.id !== commentId) } : item) }
      : day);
    onUpdate({ itinerary: nextItinerary });
  }

  function startEditingDayTitle(day) {
    setEditingDayId(day.id);
    setDayTitleDraft(day.title || '');
  }

  function saveDayTitle(day) {
    onUpdate({ itinerary: upsertItineraryDayTitle(trip.itinerary, day.date, dayTitleDraft) });
    setEditingDayId(null);
    setDayTitleDraft('');
  }

  const hasTransportCoordinates = [form.departureLatitude, form.departureLongitude, form.latitude, form.longitude]
    .every((value) => value !== '' && Number.isFinite(Number(value)));
  const canCompare = form.type === 'hotel' || form.type === 'plane' || form.type === 'ticket'
    || (form.type === 'car' && ['driving', 'plane'].includes(form.transportMode));

  function renderActivityForm(className = '') {
    const isStay = form.type === 'hotel';
    return (
      <Card className={`workspace-form-card itinerary-form-card ${className}`.trim()}>
        <form className="workspace-form" onSubmit={submitActivity}>
          <div className="workspace-form__title-row">
            <div>
              <p className="eyebrow">{t(editingActivity ? 'itinerary.editEyebrow' : 'itinerary.newEyebrow')}</p>
              <h3>{t(editingActivity ? 'itinerary.editTitle' : 'itinerary.newTitle')}</h3>
            </div>
          </div>
          <div className="workspace-form__grid">
            <Field label={t(isStay ? 'itinerary.startDate' : 'itinerary.date')}>
              <input name="date" type="date" min={trip.startDate} max={trip.endDate} value={form.date} onChange={updateField} required />
            </Field>
            <Field label={t(isStay ? 'itinerary.checkInTime' : form.type === 'car' ? 'itinerary.departureTime' : 'itinerary.time')}>
              <input name="time" type="time" value={form.time} onChange={updateField} />
            </Field>
            {isStay && (
              <Field label={t('itinerary.endDate')}>
                <input name="endDate" type="date" min={form.date || trip.startDate} max={trip.endDate} value={form.endDate || form.date} onChange={updateField} required />
              </Field>
            )}
            {isStay && (
              <Field label={t('itinerary.checkOutTime')}>
                <input name="endTime" type="time" value={form.endTime} onChange={updateField} />
              </Field>
            )}
            {form.type === 'car' && (
              <Field label={t('itinerary.arrivalTime')}>
                <input name="endTime" type="time" value={form.endTime} onChange={updateField} />
              </Field>
            )}
            <Field label={t('itinerary.type')}>
              <select name="type" value={form.type} onChange={updateField}>{ACTIVITY_TYPES.map((type) => <option key={type.id} value={type.id}>{t(type.labelKey)}</option>)}</select>
            </Field>

            {form.type === 'car' && (
              <>
                <LocationAutocomplete id="itinerary-departure-location" variant="workspace" className="workspace-form__wide" label={t('itinerary.departureLocation')} value={form.departureLocation} placeholder={t('itinerary.departurePlaceholder')} onValueChange={(value) => updateLocationText(value, 'departure')} onPlaceSelect={(place) => selectActivityPlace(place, 'departure')} />
                <LocationAutocomplete id="itinerary-arrival-location" variant="workspace" className="workspace-form__wide" label={t('itinerary.arrivalLocation')} value={form.location} placeholder={t('itinerary.arrivalPlaceholder')} onValueChange={(value) => updateLocationText(value, 'arrival')} onPlaceSelect={(place) => selectActivityPlace(place, 'arrival')} />
                <Field label={t('common.latitude')}><input name="latitude" type="number" min="-90" max="90" step="any" value={form.latitude} onChange={updateField} placeholder="35.6762" title={t('itinerary.latitudeHelp')} /></Field>
                <Field label={t('common.longitude')}><input name="longitude" type="number" min="-180" max="180" step="any" value={form.longitude} onChange={updateField} placeholder="139.6503" title={t('itinerary.longitudeHelp')} /></Field>
                <Field label={t('itinerary.transportMode')}><select name="transportMode" value={form.transportMode} onChange={updateField}>{TRANSPORT_MODES.map((mode) => <option key={mode.id} value={mode.id}>{t(mode.labelKey)}</option>)}</select></Field>
                <div className="workspace-field itinerary-estimate-action"><span>{t('itinerary.automaticEstimate')}</span><Button size="small" variant="secondary" icon="clock" disabled={!hasTransportCoordinates} onClick={calculateTransportDuration}>{t('itinerary.calculateDuration')}</Button></div>
              </>
            )}

            {form.type !== 'car' && (
              <>
                <LocationAutocomplete id={editingActivity ? `itinerary-location-${editingActivity.activityId}` : `itinerary-location-${form.date || 'new'}`} variant="workspace" className="workspace-form__wide" label={t('itinerary.location')} value={form.location} placeholder={t('itinerary.locationPlaceholder')} onValueChange={(value) => updateLocationText(value, 'arrival')} onPlaceSelect={(place) => selectActivityPlace(place, 'arrival')} />
                <Field label={t('common.latitude')}><input name="latitude" type="number" min="-90" max="90" step="any" value={form.latitude} onChange={updateField} placeholder="35.6762" title={t('itinerary.latitudeHelp')} /></Field>
                <Field label={t('common.longitude')}><input name="longitude" type="number" min="-180" max="180" step="any" value={form.longitude} onChange={updateField} placeholder="139.6503" title={t('itinerary.longitudeHelp')} /></Field>
              </>
            )}

            <Field label={t('itinerary.titleLabel')} className="workspace-form__wide">
              <input name="title" value={form.title} onChange={updateField} placeholder={t('itinerary.titleGeneratedPlaceholder')} />
            </Field>

            {!isStay && (
              <fieldset className="workspace-field duration-field workspace-form__wide">
                <legend>{t('itinerary.duration')}</legend>
                <div className="duration-field__controls">
                  <label><span>{t('itinerary.hours')}</span><input name="durationHours" type="number" min="0" max="72" step="1" value={form.durationHours} onChange={updateField} /></label>
                  <label><span>{t('itinerary.minutePart')}</span><input name="durationRemainderMinutes" type="number" min="0" max="59" step="1" value={form.durationRemainderMinutes} onChange={updateField} /></label>
                </div>
              </fieldset>
            )}
            <div className="workspace-field itinerary-cost-field workspace-form__wide">
              <span>{t('itinerary.estimatedCost')} ({trip.currency})</span>
              <div className="itinerary-cost-field__control">
                <input name="estimatedCost" type="number" min="0" step="0.01" value={form.estimatedCost} onChange={updateField} />
                {form.type === 'car' && form.transportMode === 'driving' && (
                  <Button type="button" size="small" variant="secondary" icon="calculator" onClick={() => setShowTransportCost((value) => !value)}>{t('itinerary.calculateCost')}</Button>
                )}
              </div>
            </div>
            {showTransportCost && form.type === 'car' && form.transportMode === 'driving' && (
              <fieldset className="transport-cost-calculator workspace-form__full">
                <legend>{t('itinerary.costCalculatorTitle')}</legend>
                <div className="transport-cost-calculator__grid">
                  <Field label={t('itinerary.distanceKm')}><input name="routeDistanceKm" type="number" min="0" step="0.1" value={form.routeDistanceKm} onChange={updateField} /></Field>
                  <Field label={t('itinerary.vehicleType')}><select name="vehicleType" value={form.vehicleType} onChange={updateField}>{['city', 'compact', 'sedan', 'suv', 'van'].map((value) => <option key={value} value={value}>{t(`itinerary.vehicleTypes.${value}`)}</option>)}</select></Field>
                  <Field label={t('itinerary.fuelType')}><select name="fuelType" value={form.fuelType} onChange={updateField}>{['petrol', 'diesel', 'hybrid'].map((value) => <option key={value} value={value}>{t(`itinerary.fuelTypes.${value}`)}</option>)}</select></Field>
                  <Field label={t('itinerary.consumption')}><input name="consumptionLPer100Km" type="number" min="0" step="0.1" value={form.consumptionLPer100Km} onChange={updateField} /></Field>
                  <Field label={t('itinerary.fuelPrice')}><input name="fuelPricePerLiter" type="number" min="0" step="0.01" value={form.fuelPricePerLiter} onChange={updateField} /></Field>
                  <Field label={t('itinerary.tolls')}><input name="tolls" type="number" min="0" step="0.01" value={form.tolls} onChange={updateField} /></Field>
                  <label className="workspace-field vehicle-wear-toggle">
                    <span className="vehicle-wear-toggle__control">
                      <input name="includeWear" type="checkbox" checked={form.includeWear} onChange={(event) => setForm((current) => ({ ...current, includeWear: event.target.checked }))} />
                      <span>{t('itinerary.includeWear')}</span>
                    </span>
                    <small className="workspace-field__hint">{t('itinerary.includeWearHint')}</small>
                  </label>
                  {form.includeWear && (
                    <Field label={t('itinerary.wearCostPerKm')}><input name="wearCostPerKm" type="number" min="0" step="0.01" value={form.wearCostPerKm} onChange={updateField} /></Field>
                  )}
                </div>
                <div className="transport-cost-calculator__actions"><Button type="button" size="small" icon="calculator" disabled={!form.routeDistanceKm || !form.fuelPricePerLiter} onClick={calculateTransportCost}>{t('itinerary.applyCostEstimate')}</Button></div>
              </fieldset>
            )}
            <Field label={t('itinerary.notes')} className="workspace-form__full"><textarea name="notes" rows="3" value={form.notes} onChange={updateField} placeholder={t('itinerary.notesPlaceholder')} /></Field>
          </div>
          <div className="workspace-form__actions">
            <Button variant="ghost" onClick={closeForm}>{t('common.cancel')}</Button>
            {canCompare && onOpenBooking && <Button type="button" variant="secondary" icon="search" onClick={saveAndCompare}>{t(editingActivity ? 'itinerary.saveAndCompare' : 'itinerary.addAndCompare')}</Button>}
            <Button type="submit" icon={editingActivity ? 'save' : 'plus'}>{t(editingActivity ? 'itinerary.saveChanges' : 'itinerary.add')}</Button>
          </div>
        </form>
      </Card>
    );
  }

  function renderItineraryItem(day, item, itemIndex) {
    const isHotel = item.type === 'hotel';
    const stayRole = isHotel ? (item.stayRole || 'single') : '';
    const isStayMiddle = stayRole === 'stay';
    const isStayCheckout = stayRole === 'checkout';
    const isStaySecondary = isStayMiddle || isStayCheckout;
    const categoryLabel = isHotel
      ? t(stayRole === 'checkin'
          ? 'itinerary.hotelCheckIn'
          : stayRole === 'checkout'
            ? 'itinerary.hotelCheckOut'
            : stayRole === 'stay'
              ? 'itinerary.hotelStay'
              : 'itinerary.hotelSingleDay')
      : `${getCategoryLabel(ACTIVITY_TYPES, item.type, t)}${item.type === 'car' && item.transportMode ? ` · ${t(`itinerary.transportModes.${item.transportMode}`)}` : ''}`;

    return (
      <article id={`itinerary-activity-${item.id}`} tabIndex="-1" className={`itinerary-item${isHotel ? ' itinerary-item--hotel' : ''}${isStayMiddle ? ' itinerary-item--stay-continuation' : ''}${isStayCheckout ? ' itinerary-item--stay-checkout' : ''}`}>
        <time>{isStayMiddle ? '' : (item.time || '—')}</time>
        <span className={`itinerary-item__icon itinerary-item__icon--${item.type}`}><Icon name={item.type} size={18} /></span>
        <div className="itinerary-item__content">
          <span>{categoryLabel}</span>
          <h4>{item.title}</h4>
          {item.type === 'car' && item.departureLocation && <p><Icon name="circleDot" size={14} /> {item.departureLocation}</p>}
          {item.type === 'car' && item.time && item.endTime && <p><Icon name="clock" size={14} /> {item.time} → {item.endTime}</p>}
          {item.location && <p><Icon name="pin" size={14} /> {item.location}</p>}
          {isHotel && stayRole === 'single' && item.checkOutTime && <p><Icon name="clock" size={14} /> {t('itinerary.hotelSingleTimes', { checkIn: item.checkInTime || item.time || '—', checkOut: item.checkOutTime })}</p>}
          {isHotel && !isStaySecondary && item.stayStartDate && item.stayEndDate && <p><Icon name="calendarRange" size={14} /> {t('itinerary.stayDates', { start: formatLocalizedDate(item.stayStartDate, locale, 'compact'), end: formatLocalizedDate(item.stayEndDate, locale, 'compact') })}</p>}
          {!isStaySecondary && (item.durationMinutes > 0 || item.estimatedCost > 0) && <small>{item.durationMinutes > 0 && formatDuration(item.durationMinutes, t)}{item.durationMinutes > 0 && item.estimatedCost > 0 && ' · '}{item.estimatedCost > 0 && `${Number(item.estimatedCost).toFixed(2)} ${trip.currency}`}</small>}
          {!isStaySecondary && item.notes && <em>{item.notes}</em>}
          {!isStaySecondary && item.completedAt && <Badge tone="success" className="itinerary-item__completed">{t('companion.markDone')}</Badge>}
          {!isStaySecondary && reservationTypeForActivity(item.type) && (
            <button className="text-link itinerary-item__reservation-link" type="button" onClick={() => createReservationFromActivity(day, item)}>
              <Icon name="receipt" size={15} /> {item.linkedReservationId ? t('itinerary.openLinkedReservation') : t('itinerary.createReservation')}
            </button>
          )}
          {!isStaySecondary && <DiscussionThread comments={item.comments} currentUserName={getCurrentActorName(trip)} onAdd={(message) => addActivityComment(day.id, item, message)} onRemove={(commentId) => removeActivityComment(day.id, item.id, commentId)} />}
        </div>
        <div className="item-actions">
          {!isHotel && <button className="icon-button icon-button--small" type="button" disabled={itemIndex === 0} aria-label={t('itinerary.moveUp', { name: item.title })} onClick={() => moveActivity(day.id, item.id, 'up')}><Icon name="chevronUp" size={16} /></button>}
          {!isHotel && <button className="icon-button icon-button--small" type="button" disabled={itemIndex === day.items.length - 1} aria-label={t('itinerary.moveDown', { name: item.title })} onClick={() => moveActivity(day.id, item.id, 'down')}><Icon name="chevronDown" size={16} /></button>}
          <button className="icon-button icon-button--small" type="button" aria-label={`${t('common.edit')} ${item.title}`} onClick={() => openEditForm(day, item)}><Icon name="edit" size={16} /></button>
          <button className="icon-button icon-button--small" type="button" aria-label={`${t('common.delete')} ${item.title}`} onClick={() => removeActivity(day.id, item)}><Icon name="trash" size={16} /></button>
        </div>
      </article>
    );
  }

  return (
    <div className="workspace-section itinerary-workspace">
      <section className="workspace-section__heading">
        <div><p className="eyebrow">{t('itinerary.eyebrow')}</p><h2>{t('itinerary.title')}</h2><p>{t('itinerary.intro')}</p></div>
        <Button icon={isFormOpen && !editingActivity ? 'close' : 'plus'} onClick={() => (isFormOpen && !editingActivity ? closeForm() : openCreateForm())}>
          {isFormOpen && !editingActivity ? t('common.close') : t('itinerary.addActivity')}
        </Button>
      </section>

      {isFormOpen && !editingActivity && !inlineCreateDate && (
        <>
          <div ref={formAnchorRef} className="workspace-form-anchor" />
          {renderActivityForm('itinerary-form-card--create')}
        </>
      )}

      <div className="itinerary-days">
        {itinerary.map((day, dayIndex) => (
          <Card key={day.id} className={day.items.length ? 'itinerary-day' : 'itinerary-day itinerary-day--empty'}>
            <header className="itinerary-day__header">
              <span>{t('itinerary.day', { count: dayIndex + 1 })}</span>
              <div className="itinerary-day__heading-copy">
                <h3>{formatLocalizedDate(day.date, locale, 'long', t('itinerary.dateToDefine'))}</h3>
                {editingDayId === day.id ? (
                  <form className="itinerary-day-title-editor" onSubmit={(event) => { event.preventDefault(); saveDayTitle(day); }}>
                    <input value={dayTitleDraft} onChange={(event) => setDayTitleDraft(event.target.value)} placeholder={t('itinerary.dayTitlePlaceholder')} autoFocus />
                    <button type="submit" className="icon-button icon-button--small" aria-label={t('common.save')}><Icon name="check" size={15} /></button>
                    <button type="button" className="icon-button icon-button--small" aria-label={t('common.cancel')} onClick={() => setEditingDayId(null)}><Icon name="close" size={15} /></button>
                  </form>
                ) : (
                  <div className="itinerary-day-title-display">
                    <p>{day.title || t(day.items.length === 1 ? 'itinerary.plannedItem' : 'itinerary.plannedItems', { count: day.items.length })}</p>
                    <button className="icon-button icon-button--tiny" type="button" aria-label={t('itinerary.editDayTitle')} title={t('itinerary.editDayTitle')} onClick={() => startEditingDayTitle(day)}><Icon name="edit" size={13} /></button>
                  </div>
                )}
              </div>
            </header>
            {day.items.length > 0 ? (
              <div className="itinerary-list">
                {day.items.map((item, itemIndex) => (
                  <Fragment key={item.id}>
                    {renderItineraryItem(day, item, itemIndex)}
                    {isFormOpen && editingActivity?.activityId === item.id && renderActivityForm('itinerary-form-card--inline')}
                  </Fragment>
                ))}              </div>
            ) : <button className="itinerary-day__empty-action" type="button" onClick={() => openCreateForm(day.date, 'day')}><Icon name="plus" size={18} /> {t('itinerary.emptyDayAction')}</button>}
            {day.items.length > 0 && !(isFormOpen && !editingActivity && inlineCreateDate === day.date) && (
              <div className="itinerary-day__inline-add"><Button size="small" variant="secondary" icon="plus" onClick={() => openCreateForm(day.date, 'day')}>{t('itinerary.addForDay')}</Button></div>
            )}
            {isFormOpen && !editingActivity && inlineCreateDate === day.date && renderActivityForm('itinerary-form-card--inline itinerary-form-card--inline-create')}
          </Card>
        ))}
      </div>

      <div className="itinerary-bottom-action"><Button icon="plus" onClick={() => openCreateForm(getLastUsedItineraryDate(trip), 'day')}>{t('itinerary.addActivityBottom')}</Button></div>
    </div>
  );
}

function Field({ label, className = '', children }) { return <label className={`workspace-field ${className}`.trim()}><span>{label}</span>{children}</label>; }
function deriveTitleFromLocation(value) {
  return String(value || '').split(',')[0].trim();
}
function isAutofilledActivityTitle(activity) {
  if (!activity) return false;
  const title = String(activity.title || '').trim();
  if (!title) return true;
  if (activity.type === 'car') {
    const departure = deriveTitleFromLocation(activity.departureLocation);
    const arrival = deriveTitleFromLocation(activity.location);
    return Boolean(departure && arrival && title === `${departure} → ${arrival}`);
  }
  return title === deriveTitleFromLocation(activity.location);
}
function addMinutesToDateTime(date, time, durationMinutes) {
  if (!date || !time || durationMinutes <= 0) return { date: date || '', time: '' };
  const value = new Date(`${date}T${time}:00`);
  if (Number.isNaN(value.getTime())) return { date, time: '' };
  value.setMinutes(value.getMinutes() + durationMinutes);
  return {
    date: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
    time: `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`,
  };
}
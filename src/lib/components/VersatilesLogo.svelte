<script lang="ts">
	/**
	 * The VersaTiles logo in gray (`versatiles-logo-gray.svg` of the project's
	 * graphics) as a watermark for the corner of the map: on a black plate in
	 * the shape of its hexagon, and the whole of it nearly transparent, so it
	 * darkens the map a little and leaves the logo as a faint relief. That
	 * reads on light and on dark maps; `onDark` makes it a little stronger
	 * for the dark ones. As high as the element it is in.
	 */
	let { onDark = false }: { onDark?: boolean } = $props();
</script>

<svg viewBox="-2.4245 0 36.193 36.193" aria-hidden="true">
	<defs>
		<linearGradient
			id="versatiles-logo-0"
			x1="363.33"
			x2="415.07"
			y1="199.32"
			y2="126.38"
			gradientTransform="matrix(.70538 0 0 .70538 54.155 15.902)"
			gradientUnits="userSpaceOnUse"
		>
			<stop stop-color="#3f3f3f" offset="0" /><stop stop-color="#444444" offset="0.125" /><stop
				stop-color="#4a4a4a"
				offset="0.25"
			/><stop stop-color="#505050" offset="0.375" /><stop stop-color="#575757" offset="0.5" /><stop
				stop-color="#5d5d5d"
				offset="0.625"
			/><stop stop-color="#646464" offset="0.75" /><stop stop-color="#6b6b6b" offset="0.875" /><stop
				stop-color="#727272"
				offset="1"
			/>
		</linearGradient>
		<linearGradient
			id="versatiles-logo-1"
			x1="363.33"
			x2="415.07"
			y1="215.98"
			y2="126.38"
			gradientTransform="matrix(.70538 0 0 .70538 54.155 15.902)"
			gradientUnits="userSpaceOnUse"
		>
			<stop stop-color="#9e9e9e" offset="0" /><stop stop-color="#909090" offset="0.125" /><stop
				stop-color="#838383"
				offset="0.25"
			/><stop stop-color="#757575" offset="0.375" /><stop stop-color="#686868" offset="0.5" /><stop
				stop-color="#5b5b5b"
				offset="0.625"
			/><stop stop-color="#4e4e4e" offset="0.75" /><stop stop-color="#414141" offset="0.875" /><stop
				stop-color="#353535"
				offset="1"
			/>
		</linearGradient>
		<linearGradient
			id="versatiles-logo-2"
			x1="363.33"
			x2="311.6"
			y1="199.32"
			y2="126.38"
			gradientTransform="matrix(.70538 0 0 .70538 54.155 15.902)"
			gradientUnits="userSpaceOnUse"
		>
			<stop stop-color="#2b2b2b" offset="0" /><stop stop-color="#333333" offset="0.125" /><stop
				stop-color="#3c3c3c"
				offset="0.25"
			/><stop stop-color="#444444" offset="0.375" /><stop stop-color="#4d4d4d" offset="0.5" /><stop
				stop-color="#565656"
				offset="0.625"
			/><stop stop-color="#5f5f5f" offset="0.75" /><stop stop-color="#696969" offset="0.875" /><stop
				stop-color="#727272"
				offset="1"
			/>
		</linearGradient>
		<linearGradient
			id="versatiles-logo-3"
			x1="363.33"
			x2="311.6"
			y1="215.98"
			y2="126.38"
			gradientTransform="matrix(.70538 0 0 .70538 54.155 15.902)"
			gradientUnits="userSpaceOnUse"
		>
			<stop stop-color="#9e9e9e" offset="0" /><stop stop-color="#929292" offset="0.125" /><stop
				stop-color="#868686"
				offset="0.25"
			/><stop stop-color="#7b7b7b" offset="0.375" /><stop stop-color="#6f6f6f" offset="0.5" /><stop
				stop-color="#646464"
				offset="0.625"
			/><stop stop-color="#595959" offset="0.75" /><stop stop-color="#4f4f4f" offset="0.875" /><stop
				stop-color="#454545"
				offset="1"
			/>
		</linearGradient>
		<linearGradient
			id="versatiles-logo-4"
			x1="363.33"
			x2="363.33"
			y1="126.38"
			y2="96.515"
			gradientTransform="matrix(.70538 0 0 .70538 54.155 15.902)"
			gradientUnits="userSpaceOnUse"
		>
			<stop stop-color="#585858" offset="0" /><stop stop-color="#595959" offset="0.125" /><stop
				stop-color="#5a5a5a"
				offset="0.25"
			/><stop stop-color="#5b5b5b" offset="0.375" /><stop stop-color="#5c5c5c" offset="0.5" /><stop
				stop-color="#5e5e5e"
				offset="0.625"
			/><stop stop-color="#606060" offset="0.75" /><stop stop-color="#636363" offset="0.875" /><stop
				stop-color="#656565"
				offset="1"
			/>
		</linearGradient>
	</defs>
	<g class="versatiles-logo" class:on-dark={onDark} transform="translate(-36.82 -130.74)">
		<g transform="matrix(.37509 0 0 .37509 -63.953 101.53)" stroke-linecap="round">
			<path
				class="plate"
				transform="matrix(.70538 0 0 .70538 54.155 15.902)"
				d="m363.33 224.65-59.232-34.198v-68.396l59.232-34.198 59.232 34.198v68.396z"
			/>
			<path
				transform="matrix(.70538 0 0 .70538 54.155 15.902)"
				d="m363.33 224.65-59.232-34.198v-68.396l59.232-34.198 59.232 34.198v68.396z"
				fill="#7b7b7b"
				fill-opacity="0.235"
				stroke-width="4.5354"
			/>
			<g stroke-width="3.1992">
				<path
					d="m326.57 105.05-5.9466 3.4333c-10.181 5.8781-10.182 11.756-10.182 11.756l4.5e-4 36.258 10.181-5.8786c0-30.379-1.1e-4 -30.379 16.129-39.692 0.13997-0.0808 10.04-5.7958 10.181-5.8773-10.181-5.8787-10.181-5.8787-20.363 0z"
					fill="url(#versatiles-logo-0)"
				/>
				<path
					d="m346.94 105.05c-3.3938 1.9594-6.7874 3.9179-10.181 5.8773 0 30.38-2.4e-4 30.38-26.31 45.57v11.756c36.491-21.068 36.491-21.067 36.491-63.204z"
					fill="url(#versatiles-logo-1)"
				/>
				<path
					d="m294.32 105.05c-10.182-5.8783-10.182-5.8783-20.363 0 0.40603 0.23442 9.7838 5.6486 10.18 5.8773 16.13 9.3123 16.13 9.3127 16.13 39.692l10.181 5.8782-4.5e-4 -36.258c0-5.8781-10.203-11.769-10.203-11.769z"
					fill="url(#versatiles-logo-2)"
				/>
				<path
					d="m273.95 105.05c0 42.136 1.8e-4 42.135 36.491 63.204v-11.756c-26.31-15.19-26.31-15.19-26.31-45.57-3.3938-1.9594-6.7875-3.9179-10.181-5.8773z"
					fill="url(#versatiles-logo-3)"
				/>
			</g>
			<path
				d="m310.45 83.982-5.6e-4 2.88e-4 -18.245 10.534 18.245 10.534 2.9e-4 -10.534v10.534l18.246-10.534-18.246-10.534z"
				fill="url(#versatiles-logo-4)"
				stroke-width="2.2186"
			/>
		</g>
	</g>
</svg>

<style>
	svg {
		display: block;
		height: 100%;
		aspect-ratio: 1;
	}
	.versatiles-logo {
		opacity: 0.2;

		&.on-dark {
			opacity: 0.3;
		}
	}
	.plate {
		fill: #000;
	}
</style>

import type { LocalAchievementData, LocalAchievementItem } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { gdlText, loc } from '../../steam/localization';
import { cacheLocalAchievements, localAchievementDataSignature } from './cache';
import { localAchievementPercent } from './format';
import { ensureLocalPlaybarStat } from './playbar';
import { openLocalAchievementsModal } from './modal';
import { compareEarnedAchievementsForDisplay, compareLockedAchievementsForDisplay, isRareAchievement } from './rarity';
import { getSteamRareAchievementClasses, renderSteamRareGlowHtml } from './steam-rare';
import { desktopFeatureFlags } from '../desktop/flags';
import { mountSingleDesktopNativeAchievement } from '../desktop/achievements/SingleDesktopNativeAchievement';

const COMPLETION_RIBBON_IMAGE = `<img class="gdl-la-ribbon-art" alt="" aria-hidden="true" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABcmlDQ1BpY2MAACiRdZHPK0RRFMc/M0N+R6FmIU0aVohRYmMxE0NhMfOUX5uZZ36oeTOv95402SpbRYmNXwv+ArbKWikiJVvWxAY95xk1kjm3c8/nfu89p3vPBbeSUTWzrAe0rGVEwkHf9Mysr+KRKlppxktLTDX1ieiIQkl7u8HlxKsup1bpc/9azULCVMFVKTyk6oYlPCo8vmzpDm8KN6np2ILwsXCnIRcUvnb0eIGfHE4V+MNhQ4mEwN0g7Ev94vgvVtOGJiwvx69lltSf+zgvqU1kp6IS28RbMIkQJoiPMYYJ0U8vgzL300WAbllRIr/nO3+SnOSqMuvkMVgkRRqLTlGXpHpCYlL0hIwMeaf/f/tqJvsCheq1QSh/sO2XdqjYgM91237ft+3PA/Dcw1m2mJ/bg4FX0deLmn8X6lfh5LyoxbfgdA28d3rMiH1LHnF3MgnPR1A3A42XUD1X6NnPPoe3oKzIV13A9g50yPn6+S+NBmf3U3Wf6AAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6ggdBQAKDxZ9MgAAAbp6VFh0UmF3IHByb2ZpbGUgdHlwZSBpY2MAADiNnVNrzhshDPzPKXoE4+dynA0sUu9/gQ6PTZNP6Y8UyWIzGDweT9LvWtOvsax4orHY1KuLtxBSmZA3v0KDjTWUmeywYicTxRU4LkT5QhjiQNTk2SUkSJuJuin9x+qoOhjlG2jC7cnsy5W+zH84aIf4KpTpWLBcCY1RcKyWsu4DrRFQiG687Jazgu8BOTZ+7nyuCXJOGddB+3vhDb+OJx6veK83Ph5STGZR5VsuJlz4jP8jPw2qwd7W71tjVgyihvlP0e+b1c0vM9vnzFvsDIpjUgajQBpSHlWwwy8KrwwG4gg8JGV/IxgEZOReaR1OA37B4E4bBBTG9J5W5fGAd7DCd6BiAHTsDsAh9Jge15Ubtti77bs+8tMCZoz2yvOv8LKGc+mHceElF5Fn4nJ21QVYu/pYwjZ/R5k99FZo4o8zz73tStLm+Cv5lT4x8L5sIkdfD0LfT3mspS/Kh86pPbzKxwe5xDyPY+75aAA8wy75JU3u1th9CIaH+YwlgpV5UZa96LTHm9/eR0entJiMTOMxdq11JpZSZm+8C1C3mv4An3z/rAqbnHoAAAL5elRYdFJhdyBwcm9maWxlIHR5cGUgeG1wAABIiZVWS7LiMAzc6xRzBEeypeQ4Jk52UzXLOf60ZEIM5M3jQQEhdqul1sehv7//0C+8pmlWklV2my3ppKI3LZY5KWtR00U3aczbfrvddmbcXzT7nWJScpOUm6Us2DvrQnm2agAWsZq3khW/MCgCELPssqUqq81SbVYAtTmZTpz8v666mfgaOQO8ybq7H1L7wmN7eHKawb1b+DTnVhK7P7u7wYmk8BafBH6wcwI/w7BKLZxz1hfuvub0s2W8k1TQ7WTx4s2wi7ewb7zLJIu/cZWE8c34bt0IfsWgn3tsMzcnYKHDj9ETuAE9oRbrEuEsCHyDZ/d1SMGgRPDuGWIHntzEs/MwgixcuR/c26korqGRNqwU6iAPJnTau/138+GXfm2eruwfoA/MJ9SQ74fYEpfpJ4Gc8AONrH3LGfXzPQ0NPDPSmT4IJ0znhiYZzNO3YbyYh8F2RUJ3FrGci2mvjI+1GkjIWbyZDaWHTXvhKEYvNwaguHn0N+rYi/vw41FrtWAm4LqQrmhAT3eL7dKr2P1C3Rc0SPofHOilo+kncO91SI5+xNDpE6wEZmKmY/ujcmt27yYMtlJ8uEEtna8pRgwdoLy6b2qfwA4ddfXG7dFQcfjSsyV8CZuvgLHfYsRMjqI32PIJ7I4aWoXunTYImRuu8l1GuYY9UEuWLAWTigBSsK4diIpiqAs0tpQsmG4+K5EebrC5PfnTu7B2YvKQzGthssML9vEKX3DgYNg2EUmwiTtSIwU1Bu8tdtUjIfRmPU4P7YanzwnomuGY4zHJz26vGaXpfela2nLu8uPoPHxQpzaNi+OBABWXcQVRnI2O44BUxhSbnxSQzoqXv5+1X4OjRHBlhvCRtZKjsr2/3RT+aeQxytQWTuWRdnjoU2lC8Bvy+ERCLyym3tPbz7NHXVzeR21k5f0r5WLtQn561n80cX3eHs8HA1U8IVB/bHGW1weXvnLx9ORtHnoa9wcf+geRYC/BVHQSCgAAFOBJREFUeNrVnXucHFWVx7+/6p5HJjPJZDKBTCQkAZQgRpYYER9Z94EfswHEffDRD+qugSiIGCAfWAnIAhEwaEAkbEwkIay6riBmRcHHuq6uiivyNBqjMQjhNZOQZGYyk8xMz3Td/eNWVVdXVz+mp2syOZ/kM9VVXfee+zvnnnPuuY8WRxnVLf+Tf5lG3AAgnJuQGUGQ2TjvSLM4KnKONAOjoRD4KcTlwEqhlchcjkwKRP3Fzx9pNkdFR40AAvANDrACWC3UhGhCrAZnhUEOgoaPPX+k2a2YdKQZqITywBeXIW4FTZbPvQB0CHGtI+42yEUwtH7OkWa9LE14AYTAF+JSxBpQcwR8+0/0g65BZj3IIDH0r8cf6SaUpAltggLwXYS4GPgM0BxoTT74gJoRnwFdbJSSgMbLXjjSzShJE1YAIfDBYTlwG6JFHuB54AOhztyCdJuDuzztDAOi8RMvHunmFKUJKYC6izzw504BhwuBzyGmUAx83x7JXgumID43YuovbO09AIJJK1460s2KpQnnAwLw00CWfwLuRLSCiNp9RYThgR++1wNckSX7b2mlQTDwheOOdBPzKDEBOB/8Q341YW31FTZ07aMrBdcfwoLfFgd+yO7nlRFTxwHEFUhfiZTvvVqsV+XD03/bsYnglE5KACF6I/B6wEQfGAwyXotN0F4XwwmIq4C2PBgqAj/0gv3bBtwBpgP0HJWbXQG/A7YlCU7CAhBg3o9YJRvLRJ4qH6zctePfq8DpRsCP0W5oB92GcGNZjL0nBxt1bUvSUCcogJzNUQBqGfMTRqSkeShwuvkmQ1HhBu86BQIiUn5+z0rcRyYXBSlfqSmq7SHbHwN4pMjS4AePInXFvFu8Z0UrDL2XACUmgDwfpnxAFI9sHiBxTjcKasFzoj0rUhbEKEGM4817JpKDP0kTFKfFxU1DvkmPKSPcQ0yAkDAmhFmMYBSjBIrT6Aj4imWo9jQOPiB8pxj4pU0DiKxxMBINGqYlPUBLeoBGJwMSg249/dkm+t0mMqYOm7Uz+eAHl2Xtfg7xcRglJdwDQh+rcLoG4RqHlvQApzbv5h2tv2XRlJ2cMKmLtrqDNDrDAAy6dRwYmcJzgx080Xcyjx5cwPaBefRnJ5Fy3BDWFYAfjaiMSdQHJBuGhuP7UTldkcVhavowS9qf4EMdP+LMqTtoTfeBXDw7FCrUMFedLGz5PX/f/r/0jLTwy77X8++vvosf9JzBwexkUpiKnG5hOJtsN0i0Byi2lRHAI7baePmFt7du55Nzv8FZbU9RnxoC43hfTkEKGz74IYQrm7TL2o+t6T6WtP0ff9X6ND/qeRNrX3k/v+x/Q26sV8TpFvAbVqCjTQBBY8INKON0DaLeGeGi1/yAVfO+zsyGfWBS9n89MAlo8LiOxm8uMAIMAQOCTIp6DfM3bY+ysHkna17+APe9ejYZU4fj94Zi4BdEbUehAApCxjJO1yAmpTKsmnc/V87ZSoMzZIGvA1o88EsFzSnvfwPQDAwAfcBwimPr9rFmzgY66g/w2c4PMOg2RJSgSHDga9DROA6gvc2/MsWcbjisrHOyfHLeA1w190EanAzIsUDOACaPklPHe2cGtgw5NCjDyo6vc3XH16hzRnKJqXCcH41j5fE+a2piMCUigPSFz8L+bk+bVJdrW3G7/6FZP2LlnK2kNWK/PAVoxWp1tZTyyphiGUhrhMtnPsAF7f9lfU35HFIagboOMvWG/UeHANIXPmtDN0tnAOeUcrpZHBa27OK6ef9BY2rQfmGKD1oNGBK58hCNziDXdHyF05v+iOulp8LfzQuFpXORzjDew6k3Hqg1XLUVQAC+RXcRsAkxv6jTlWhKZVg5ZyuzJ3XZSGcy1ubXmlqwZeMwu6GTy2c+wCRnyI6qiwQHHu+bJBYh67in3lRbIdRMAOllu8B1ffAXYsFfUGqk6xqHxdN+y9kzHrPgp6md5kfJ7wlpwDgsnfoL3tG8LegFUT6DYZtYANqEtNAvqnV198QSQHrZLhgcAscBOA3YBJxWbqRb74xwwcwf05w+ZG82k+zQMI2tAzE51c/72n5IvTPi8RcBP3/QdhqwSdJpNpVRT+unayOEMQsgvWyXBb6xAYxZAGwGTi+XXnZxmNfUxTun/San/U0Jgu9TE0EvWNzyDHMbOr3FdvF8+iTpdGAzYgEaxlWKabf0jJmdMQkgvWyX1RzXBTgVaTPwplJO1//sIhZN+SOzGvbbm42MLeKplFLYuhCz6vaxsOn3IWcc9QXhNgDiTZ4QTnVkJ9em3dp7ZASQXrbLXtiI5xSs2Xlz7Eg3Aj6ClAwLW3bheAk1GhKHPkdeXY6GOX3SThzlpqvLpiikNws2CU7xb45FCFUJIADf0snAJqQzi450o40CGpxhTmx6JcfFeCwPCBqQa/kJDS9T7y3gUoy5jKYovMdnIm1CnGyDKNG25mBVrIzVB8zHgv+2AOMSTjcsoIbUMDPqeu19h/ExPz75yTwD7ekeGpUJ5X9C4CumG+e6yNsQm4Tmm8IFHxXTWAVwBtIZOf6KO9383iHqlKUxlUk821iUPB4bnQx1TjZyn/yJm7gUut9+OGMsk5bVC8Bycz9wi0SmnNMNNw7ZQZhrnFzGdLzJq9MYeYOxeD6Dfh0FX2SEbkHcPxYFqkoAI1tO8pjQEGINsAYx7D+vZBVbxq3jULbRImEYXyEE9Rn63UlkqMvxW+B085Om3t9hoTVe24cADlwzpSpWqu4B7s4HfOYySLcCn0WMxE77RVoiwZCppzMz3SuMYDJlXCjr1SnoGmlnyNSHTHys0w37gBGvrbdiyGBg6Ff3Vc1K9QL4+SqyD57lMzaEuFloLWIkzukG5DVq2KTZcfh4vHw0uf4zDjSM1wvEH4bmMmzSHmslna4P/lqhmzFW83tvX8ihrSuqZmVMTtj0PhcwKTSIuAnxeVA2Nr8S0igDPNF3MoPZRvt8kPExQ8arCxg0jTw5cApGqsTpZoHPC91kMIN+5JPdt2s0tddWAADDm04Id9tB4AbgC0A2z5lFVrGlZPj1oRPZNfAakGst6Xj0gmE8q+3y7NBstg291k7YB7x5l1HwxReAGwxm0D4RB1ZVZ/fDVJNkXOaeeeEc+gDieom78TbLFZBAMuzJtPHIgTPtPRc4VHu8C+iQVxfwvf63s3dkuh0JR+2+xyd2UfHdwPXYiU6k2oAPNUxHZzbOC3VdHQZdh1gPZIvNPBmJB179C14aPBYwcJjAPCRCg9g6cHl5eCYP9p7lzYz5gBfwmQXWA9f5b0qqOuKJo5pOyGQ2zA3b0kPAtUjfjgNfiJRcfnd4LvftWWJvukAvdnVDrWnEK9u1zf5yzzn8PjOPlN8dYnwA8G3EKkJ9s5bgW05qTENfnBMeTfYJdkSzc+FQzyDu2XMOPzv4RlAWMkAPtQ1Ls16ZGUBZHj38Z9zb/d7cACzqdHOM7gD6/Y/dq2o/OZ/IpPzQ+jnICUbGJfYFgOP5gut3X8TuQc8hDwDd1KYnjHhlDQC4vJA5jhv2XsKerGf7i490EXKEjZCSAB+S3iXppxeLgO+nLFJyeaz/VK56/lK6htpzQtjnAVdNeGrILwOXrpEZfLLrch4fWEBKbsBHzEg3x2vCeaoEF2bF5VXyvpDn/By5PNL9VlwcPjdnPSdMehGGU7AfuyhrMnZ1XDmVcbGm5hA54SnLc0PHc82eFXy//+04ytn9Yv5pvGh8svCFkxqxo2QH+F7PW9kz3MaNs+/lr6c+iUwWDjsWzHrsZEoduZSyD3qWXIyf8YDHxZDif/reyupXP8rTg6eUdroxeaDIxVEkAK8xxjvkoST4oYY7cnny8Hw+/Oyn+OCMH3DhjId5XeOLFuEhB4bCwHll5iXzjDVhpPjj0Fy2dJ/H13qXcCDbas1OKacb/piXlkgMpYQX5xKvUXntjpm4ScmlO9vCuq7z+XbPYs5tfZRzWh/lDZP+RGv6IFI2B3wIJGNS9GSnsn3wRB7pewcP9y1m9/AsJJMDPw/fiNMtazaPIgEUMB+dJyjR1a2SWnR3Z2aybu/5fHn/Uk5qfIkFTc/y2sYX6ajbR7MzAIJDbhOdw+3sHDqe7UMnsiszm4NuM/J6VGyGMwJ07M6Z5PEfz5nYQjNkL2O0LgSC3Wrk0u828dTAfJ4cOAXH02hfq11SZElZYycTPI/zPeWdbsREHvU7ZOIaFdyN0boC0+DbaxOEjv5xA9lgIlkhExMSbqHNKeN04/xTsv0g+V2SYUzK7dONAT9OY4kRXH5FkZ5VqdON4TNpSnAgFizzUEXgF75e3FzEvRuxIkTercjpUlBG4pJI3AkLXgF+S3R+IPb7AjtH3io0N8Y0U/xeTjDRvV7e5fPY42tU0unm/FMK9EpRfmtECYahAd2D9NXc/bLRhgvqQNwFnFXcNKg8+DkT9t+gFUAnBb0+3j95NwcSxn9coqABjBkYjTOT1dSLkTYBf+nf9HEJmTfCEow6Xe/xj4GLwfwpHkoDRhiBEo54Yts6rrVVQC3X7vU4E8BJiM1Cfx5v98s63Z8CFwG7/Ifd1yW336samnBnxvXdekwYwF1CH0H8fNROF34OfIQAfCYc+DABBQDQd8uMsLbvRCwH/WIUTvcX9h12+umK7utaj3SzYmnCmaAwTbl+XxjxUyS2IN5Sxuk+BiwDdvgtnKjgwwTtAT4d/HQ7QUAudiAuAj1eYqT7ONbm7/CPkpjI4MMEFwDAwdXTLbZ2BfN2z7Q8GeN0nxQsB7Znvb2CEx18OAoEANB703QwaXAM2EP0lgNPh8B/GlhuYFs6BSnn6AAfaugDJl/VGSk1GrHE2O1IKqDv5hkl65h604FwKmIhcJ9XxoeBpxwvedn9qdaS5bTfcYjCo1Mi6Yo4PkO87v14bfZU1UQAAfh1wDBLgdORXRVXJmoR0lN99H+/Rc0IcfDm9pJ1ta7uDjvdN3pX2/zMcU858G/3lvj0ZqC1fgloIfJOH4rwmUtkAZIDPF1H3XczZHAchz2X1k8wAcDrgO8iThxFhnOfxGVG3O8L5uDqMkL4dDekUv7uzECZKwbf8vI+4G5Qe5k0RrinPiu0FNiJqIkAxuwDAvDtZtuP54Hvt7Z0o9pBdwmd76velDIHY/RcPw25bqCozmjBN5wP3BWAT7inFuUToRMRH8c7WPbYL459NfGYe8Dkqzv9udnFiP8ETR+N7Q/Z9D2gSyWz1X+n98bpY25gDPh/h1gPOraY7c/lmmL4hP2IvwV+JomuS+rGxNuYekAI/CbElUB58H0Kf89eHItdUX2efyxlLQ7GCMAHMJxn66A8+FHKpTumg65EajLAzI1jW743RhMUMP4eYGkoLVkc/CJrgrw3OhDrJc71vz+WgzGm334ovHDiXOxK545ifEacbq6JhXMHSwXvUQ0QrPr1yVd34qn/McAVoIZYp1s4Ws0HvzC9PMuaCJb6wFRzMMZ0T/O9WpYC6xGzivfKmJOz4sFH0IB0BY6OwcDML1XfC6oSgAU/4OrDoLdUGPHke7tC8P1Hx0naIPRu/0brzT2Vg782B76BdwMbEMeVySHF+6eAIj1XvMW23VLHpuqWc1fZA3zEzHzQJVHzHuK3lNPNF1b4Vfv92YiNYN4F4UO4KufQwLsEGxGz8wZc0S+W4jPUXBW8zCWS5msMkzijFsDkq7vshTEO6DLEvCqdbqRRYcEEf+cgbZS0yBlNGwUGFgk2AnNKjXYrcLr5PSSvLM3D/q6ZA9Cx2WW0NJad8ouBC3LMVuV0y74rqCfY+lox/mB3BtRHlaAqpxsPvn99AWgxKiLIWgog0H67WHwlYlpZpxsFv7jdp8ic7gZjeGZUrRLgOM8gNtTI6ea3MX8/8TTESsRkA8zaMjpbOboekDMR70UsqcjphoVSCvz4lWuPYw/NGx0Z7AQ72uSVUYXTJV954t7NtWuJ0HtjfETtBDD5n33bz0zEFbKr9UPMljmDs7zTzXtXYhC4A+jCGHrXnlZxo7pvOdVPEHUh7vDKytVRis/QswJAi/gsoXrsLzXNxIyuF1QkAB98r95lgkWFTJRgtnKn64MP8B3QQ/4Nt3t3xY3KHngenEBxHwJ9pyZONyok8tq9CDsVClQuhFGZIAMLBJcm7HQB9oJux9vdVc3kyr4rm/wyBxC3I/aOyukGD/2vF/qAmLWmlwILRsNnxQuzvLh6EuIe8nbAF6qu98EB/gF77uZojgMDtJlJjY8xOAim+hjbr2swe/ixxtTkzYJVZcEvtPu/QXqQYH99fFTkkYPd0TYaDstTYP+pTIuDhol/BG2W7BnM5Zyup1G/QZwDvADQfe3Y1vLMuGvAd67HIx5GWpCTTYmea++PYCf5v5zrAcWiqkJ6ZVl5eCs2QcFAqFzY6YNrVf5hxK+iZZUAfxhxJ/ACWx6ryekpkti7ohEcvYB0JzAc73RjLBD8CulhJExkKF5NxBPL39iLiKeW6/fhWKldiPgSKFXS7lsNewR4P97u9LFqv0/HrBv0JdyM+LrQ2RU43SzSR4F7MYaujyazjDaxVRFObqf8Q6AnSoMPiAPAWmoMPsDeTzR61anfO1TKTjTkx/KQz9sTgoesfBLT0+QEYJeSuCDtR2wG3CIjXV87v4pdTJsM5RTgp15d/o24ka4rewTzftdA50eSO1Mz4aMKUn7jvyXpqRwQBWHfTmAdxkYatdR+n/xlJMYxLmIdaGeJke5TiG9ByPclRIkKoPfGNkZGRpD0KnAvwo3ZMuQC6/BXMSfZYN/eS7sQ6xT9hVcLvou4F8Orxk1W+2EcVsbV1QVHQm4Fm1SLdPmfAMEOmqROJQHY87H6YGJB1gz9JH9cAohngK0o14GTpMQF0PMv06ClGUl7kLYo/FOQ9neO1mJP80nE9ERpz8e8FJbUg3XIffajwC7Q2gLsISU6lycvgfFZG9ofTBF+E7EtNGK+H/HDvJzQeJCC/z+0PASVbwO+CUB2fE6SHRcB9HyqFafOAUedSPd5t3d7g64RSNb0RKnrYt8sagTpTlleAO4DOtH4aD+M4+podySYrvsG8GvEBgzbx6v+OPIG7NuxEzfPgL4BGv0E9Fh4GM8GT1vTS7cOMM1tOw94AngZxlf7w9RxT9YPx16DWMRxeoiXDJ0Xjd+q/f8H4TgZ9HrRSRoAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDgtMjlUMDQ6NTc6MzUrMDA6MDDxDkoHAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA4LTI5VDA0OjMxOjA0KzAwOjAwTQBE6AAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wOC0yOVQwNTowMDoxMCswMDowMIlGlQAAAAAASUVORK5CYII=" />`;

const NATIVE_SIDEBAR_ACHIEVEMENT_TILE_PX = 48;
const NATIVE_SIDEBAR_ACHIEVEMENT_GAP_PX = 8;
const NATIVE_SIDEBAR_ACHIEVEMENT_MAX_CELLS = 5;
const NATIVE_SIDEBAR_ACHIEVEMENT_MIN_CELLS = 2;
const NATIVE_SIDEBAR_ACHIEVEMENT_MAX_EARNED_ICONS = 4;
const NATIVE_SIDEBAR_ACHIEVEMENT_MAX_LOCKED_ICONS = 4;

/** Match Steam's sidebar behavior: compact achievement tiles, a fixed gap,
 * and a dynamic number of visible cells derived from the live row width. Rows
 * never grow beyond the native cap: 1 featured icon + 4 earned thumbnails,
 * and up to 4 locked thumbnails. Only the two highest-priority rare earned
 * achievements animate; the rest remain static. A +N cell appears when extra
 * items exist or when the current width cannot fit the native maximum. */
export function achievementSidebarColumnsForWidth(width: number): number {
	if (!Number.isFinite(width) || width <= 0) return NATIVE_SIDEBAR_ACHIEVEMENT_MAX_CELLS;
	const columns = Math.floor((width + NATIVE_SIDEBAR_ACHIEVEMENT_GAP_PX)
		/ (NATIVE_SIDEBAR_ACHIEVEMENT_TILE_PX + NATIVE_SIDEBAR_ACHIEVEMENT_GAP_PX));
	return Math.max(
		NATIVE_SIDEBAR_ACHIEVEMENT_MIN_CELLS,
		Math.min(NATIVE_SIDEBAR_ACHIEVEMENT_MAX_CELLS, columns),
	);
}

function localAchievementIcon(
	item: LocalAchievementItem,
	locked = false,
	allowGlowOrHighlighted: boolean | ReadonlySet<string> = false,
): string {
	const url = locked ? (item.icon_gray || item.icon) : item.icon;
	const allowGlow = typeof allowGlowOrHighlighted === 'boolean'
		? allowGlowOrHighlighted
		: allowGlowOrHighlighted.has(String(item.name));
	const isRare = !locked && allowGlow && (isRareAchievement(item) || item.global_percent == null);
	const rareClasses = getSteamRareAchievementClasses();
	const frameClass = `gdl-la-icon-frame ${rareClasses.wrapper}${isRare ? ' is-rare' : ''}`;
	const glowHtml = isRare ? renderSteamRareGlowHtml(rareClasses) : '';

	if (!url) {
		if (item.name.startsWith('GDL_PENDING_')) {
			return `<div class="${frameClass}"><div class="gdl-la-icon ${rareClasses.icon} gdl-la-icon-fallback${locked ? ' is-locked' : ''}">★</div></div>`;
		}
		return `<div class="${frameClass}">${glowHtml}<div class="gdl-la-icon ${rareClasses.icon} gdl-la-icon-fallback${locked ? ' is-locked' : ''}${isRare ? ` is-rare-glow ${rareClasses.iconGlow}` : ''}">★</div></div>`;
	}
	return `<div class="${frameClass}">${glowHtml}<img class="gdl-la-icon ${rareClasses.icon}${locked ? ' is-locked' : ''}${isRare ? ` is-rare-glow ${rareClasses.iconGlow}` : ''}" src="${escapeHtml(url)}" loading="lazy" data-gdl-invisible-on-error="1" /></div>`;
}

function renderAchievementIconRowHtml(
	items: LocalAchievementItem[],
	availableCells: number,
	locked: boolean,
	maxVisibleIcons: number,
	allowGlow: boolean | ReadonlySet<string> = false,
): string {
	if (!items.length) return '';
	const capacity = Math.max(1, Math.min(NATIVE_SIDEBAR_ACHIEVEMENT_MAX_CELLS, availableCells));
	const nativeIconLimit = Math.max(1, maxVisibleIcons);
	const needsMore = items.length > Math.min(nativeIconLimit, capacity);
	const countToShow = needsMore
		? Math.max(1, Math.min(nativeIconLimit, capacity - 1))
		: Math.min(items.length, nativeIconLimit, capacity);
	const thumbnails = items.slice(0, countToShow);
	const moreCount = Math.max(0, items.length - countToShow);
	const iconsHtml = thumbnails.map(item => localAchievementIcon(item, locked, allowGlow)).join('');
	const moreHtml = moreCount > 0 ? `<div class="gdl-la-more">+${moreCount}</div>` : '';
	const renderedCells = countToShow + (moreCount > 0 ? 1 : 0);
	return `<div class="gdl-la-icon-row" data-gdl-achievement-columns="${renderedCells}" style="--gdl-achievement-columns:${renderedCells};">${iconsHtml}${moreHtml}</div>`;
}

function renderFeaturedAchievementHtml(item: LocalAchievementItem, allowGlow = true): string {
	return `<div class="gdl-la-feature">${localAchievementIcon(item, false, allowGlow)}<div class="gdl-la-feature-copy"><div class="gdl-la-feature-title">${escapeHtml(item.display_name || item.name)}</div><div class="gdl-la-feature-desc">${escapeHtml(item.description || '')}</div></div></div>`;
}

export function renderLocalAchievementSidebarHtml(data: LocalAchievementData, columns = 6): string {
	if (data.total <= 0) return '';
	const signature = localAchievementDataSignature(data);
	const pct = localAchievementPercent(data);
	const isAllUnlocked = data.unlocked >= data.total && data.total > 0;
	const earned = data.achievements.filter(item => item.earned).sort(compareEarnedAchievementsForDisplay);
	const locked = data.achievements.filter(item => !item.earned).sort(compareLockedAchievementsForDisplay);
	const featuredEarned = earned.slice(0, 1);
	const otherEarned = earned.length <= 2 ? earned.slice(1) : earned.slice(1);
	const latestHtml = featuredEarned.map(item => renderFeaturedAchievementHtml(item, true)).join('');
	const earnedRow = otherEarned.length
		? `<div class="gdl-la-earned-row-wrap">${renderAchievementIconRowHtml(otherEarned, columns, false, NATIVE_SIDEBAR_ACHIEVEMENT_MAX_EARNED_ICONS, false)}</div>`
		: '';
	const lockedBlock = locked.length
		? `<div class="gdl-la-divider"></div><div class="gdl-la-locked-label">${escapeHtml(gdlText('locked_achievements', 'Locked achievements'))}</div><div class="gdl-la-locked-row-wrap">${renderAchievementIconRowHtml(locked, columns, true, NATIVE_SIDEBAR_ACHIEVEMENT_MAX_LOCKED_ICONS, false)}</div>`
		: '';

	if (isAllUnlocked) {
		return `
		<div class="gdl-la-summary is-complete" data-gdl-local-ach="1" data-gdl-achievement-signature="${escapeHtml(signature)}">
			<div class="gdl-la-ribbon-badge">${COMPLETION_RIBBON_IMAGE}</div>
			<div class="gdl-la-header is-complete">
				<div class="gdl-la-unlocked">${escapeHtml(gdlText('all_achievements_unlocked', 'You\'ve unlocked all {total} achievements! {unlocked}/{total}', { unlocked: data.unlocked, total: data.total }))}</div>
				<div class="gdl-la-unlocked-sub">(100%)</div>
				<div class="gdl-la-progress-track"><div class="gdl-la-progress-fill" style="width:100%"></div></div>
			</div>
			<div class="gdl-la-body">
				${latestHtml}
				${earnedRow}
				${lockedBlock}
				<div class="gdl-la-view">${escapeHtml(gdlText('view_all_achievements', 'View all achievements'))}</div>
			</div>
		</div>`;
	}

	return `
	<div class="gdl-la-summary" data-gdl-local-ach="1" data-gdl-achievement-signature="${escapeHtml(signature)}">
		<div class="gdl-la-header">
			<div class="gdl-la-unlocked">${escapeHtml(gdlText('achievements_unlocked', '{unlocked} of {total} achievements unlocked', { unlocked: data.unlocked, total: data.total }))} <span class="pct">(${pct}%)</span></div>
			<div class="gdl-la-progress-track"><div class="gdl-la-progress-fill" style="width:${pct}%"></div></div>
		</div>
		<div class="gdl-la-body">
			${latestHtml}
			${earnedRow}
			${lockedBlock}
			<div class="gdl-la-view">${escapeHtml(gdlText('view_all_achievements', 'View all achievements'))}</div>
		</div>
	</div>`;
}

function setupDynamicGrid(summary: HTMLElement, data: LocalAchievementData): () => void {
	let currentColumns = NATIVE_SIDEBAR_ACHIEVEMENT_MAX_CELLS;
	const earned = data.achievements.filter(item => item.earned).sort(compareEarnedAchievementsForDisplay);
	const locked = data.achievements.filter(item => !item.earned).sort(compareLockedAchievementsForDisplay);
	const otherEarned = earned.slice(1);

	const availableRowWidth = (): number => {
		const earnedWrap = summary.querySelector<HTMLElement>('.gdl-la-earned-row-wrap');
		const lockedWrap = summary.querySelector<HTMLElement>('.gdl-la-locked-row-wrap');
		const direct = earnedWrap?.clientWidth || lockedWrap?.clientWidth;
		if (direct && direct > 0) return direct;
		const body = summary.querySelector<HTMLElement>('.gdl-la-body');
		if (!body) return Math.max(0, summary.clientWidth - 20);
		const view = body.ownerDocument.defaultView;
		if (!view) return body.clientWidth;
		const computed = view.getComputedStyle(body);
		const left = Number.parseFloat(computed.paddingLeft) || 0;
		const right = Number.parseFloat(computed.paddingRight) || 0;
		return Math.max(0, body.clientWidth - left - right);
	};

	const update = () => {
		if (!summary.isConnected) return;
		const width = availableRowWidth();
		if (width <= 0) return;
		const columns = achievementSidebarColumnsForWidth(width);
		if (columns === currentColumns) return;
		currentColumns = columns;
		const earnedWrap = summary.querySelector<HTMLElement>('.gdl-la-earned-row-wrap');
		if (earnedWrap && otherEarned.length) {
			earnedWrap.innerHTML = renderAchievementIconRowHtml(
				otherEarned,
				columns,
				false,
				NATIVE_SIDEBAR_ACHIEVEMENT_MAX_EARNED_ICONS,
				false,
			);
		}
		const lockedWrap = summary.querySelector<HTMLElement>('.gdl-la-locked-row-wrap');
		if (lockedWrap && locked.length) {
			lockedWrap.innerHTML = renderAchievementIconRowHtml(
				locked,
				columns,
				true,
				NATIVE_SIDEBAR_ACHIEVEMENT_MAX_LOCKED_ICONS,
				false,
			);
		}
	};

	const ResizeObserverCtor = summary.ownerDocument.defaultView?.ResizeObserver;
	if (typeof ResizeObserverCtor === 'function') {
		const observer = new ResizeObserverCtor(() => update());
		observer.observe(summary);
		const body = summary.querySelector<HTMLElement>('.gdl-la-body');
		if (body) observer.observe(body);
		queueMicrotask(update);
		return () => observer.disconnect();
	}
	const onResize = () => update();
	summary.ownerDocument.defaultView?.addEventListener('resize', onResize);
	queueMicrotask(update);
	return () => summary.ownerDocument.defaultView?.removeEventListener('resize', onResize);
}

const sidebarGridCleanup = new WeakMap<HTMLElement, () => void>();

export function ensureLocalAchievementSidebarResponsiveGrid(summary: HTMLElement, data: LocalAchievementData): void {
	const previous = sidebarGridCleanup.get(summary);
	if (previous) previous();
	sidebarGridCleanup.set(summary, setupDynamicGrid(summary, data));
}

/** Reveal a metadata-only fallback after the local progress request has
 * conclusively completed. Until then, showing it as 0/N would be misleading. */
export function revealPendingAchievementSidebar(doc: Document): void {
	doc.getElementById('gdl-achievements-section')
		?.removeAttribute('data-gdl-achievements-pending');
}

export function renderLocalAchievementSidebar(doc: Document, data: LocalAchievementData): void {
	if (!data || data.total <= 0) return;
	const section = doc.getElementById('gdl-achievements-section');
	if (!section) return;
	let content = doc.getElementById('gdl-achievements-content');
	if (!content) {
		if (!section.querySelector('h2')) {
			const heading = doc.createElement('h2');
			heading.className = 'gdl-native-section-heading';
			heading.textContent = loc('AppDetails_SectionTitle_Achievements', gdlText('achievements_label', 'Achievements'));
			section.insertBefore(heading, section.firstChild);
		}
		content = doc.createElement('div');
		content.id = 'gdl-achievements-content';
		section.appendChild(content);
	}
	const signature = localAchievementDataSignature(data);
	const existing = content.querySelector<HTMLElement>('.gdl-la-summary');
	if (existing && existing.dataset.gdlAchievementSignature === signature) {
		if (!sidebarGridCleanup.has(existing)) ensureLocalAchievementSidebarResponsiveGrid(existing, data);
		return;
	}
	cacheLocalAchievements(data);
	const oldCleanup = existing ? sidebarGridCleanup.get(existing) : undefined;
	if (oldCleanup) {
		oldCleanup();
		sidebarGridCleanup.delete(existing!);
	}
	content.innerHTML = renderLocalAchievementSidebarHtml(data);
	const summary = content.querySelector<HTMLElement>('.gdl-la-summary');
	if (summary) {
		ensureLocalAchievementSidebarResponsiveGrid(summary, data);
		if (desktopFeatureFlags.desktopNativeAchievements && data.achievements.length) {
			const nativeSlot = summary.querySelector<HTMLElement>('.gdl-la-latest');
			const featured = data.achievements.find(item => item.earned) || data.achievements[0];
			if (nativeSlot && featured) {
				mountSingleDesktopNativeAchievement(nativeSlot, featured);
			}
		}
	}
	const open = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		void openLocalAchievementsModal(doc, data).catch(error => backendLog('Achievements modal error: ' + error));
	};
	content.onclick = open;
	const viewAll = content.querySelector('.gdl-la-view') as HTMLElement | null;
	if (viewAll) viewAll.onclick = open;
	ensureLocalPlaybarStat(doc, data);
}
